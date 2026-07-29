#!/usr/bin/env node
/**
 * Validate the marketplace manifest, every plugin manifest, and every path they
 * point at — before a partner's `/plugin marketplace add` finds the mistake.
 *
 * Dependency-free on purpose: it runs with a bare `node scripts/validate-manifests.mjs`
 * on any Node 20+, in CI or on a laptop, with nothing installed.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Severity policy — the one judgement call in this file, kept in one place.
 *
 * `error` fails CI and blocks the push. Reserved for things that are broken for
 * a partner: a manifest that will not parse, a path that does not resolve, a
 * skill Claude cannot invoke, or internal content leaking into a public repo.
 *
 * `warn` prints and passes. For things that are worth knowing but where a
 * hard failure would block legitimate work — a skill description drifting long,
 * a version that has not been bumped.
 */
const SEVERITY = {
  manifestUnparseable: 'error',
  manifestFieldMissing: 'error',
  pathUnresolved: 'error',
  skillFrontmatterInvalid: 'error',
  skillNameMismatch: 'error',
  internalLeak: 'error',
  versionMismatch: 'error',
  descriptionTooLong: 'warn',
  skillNoWhenToUse: 'warn',
};

/**
 * Tokens that must never reach a public partner-facing repo. This repo was
 * extracted from an internal monorepo; the guard is here so a future sync
 * cannot quietly bring internal package names or document paths back with it.
 */
const INTERNAL_TOKENS = [
  /\barka\b/i,
  /gitlab/i,
  /jobflow-poc/i,
  /@fiery-lab/i,
  /fiery-contrib/i,
  /docs\/partner-kit/i,
  /RFC-[A-Z-]+\.md/,
  /node-craft-internal/i,
];

/** Frontmatter descriptions past this get unreliable at invocation time. */
const MAX_DESCRIPTION_LENGTH = 1024;

const problems = [];

function report(kind, file, message) {
  const severity = SEVERITY[kind] ?? 'error';
  problems.push({ severity, kind, file: relative(ROOT, file), message });
}

function readJson(file, kind = 'manifestUnparseable') {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    report(kind, file, `does not parse as JSON: ${err.message}`);
    return null;
  }
}

/** Minimal YAML frontmatter reader — enough for `name` and `description`. */
function readFrontmatter(file) {
  const text = readFileSync(file, 'utf8');
  if (!text.startsWith('---\n')) return null;
  const end = text.indexOf('\n---', 4);
  if (end === -1) return null;

  const fields = {};
  for (const line of text.slice(4, end).split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    fields[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return { fields, body: text.slice(end + 4) };
}

/** Every file that ships to a partner, for the internal-token sweep. */
function* publishedFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* publishedFiles(path);
    } else if (/\.(md|json|ts|js|mjs|html)$/.test(entry.name)) {
      yield path;
    }
  }
}

function requireFields(obj, fields, file, label) {
  for (const field of fields) {
    if (obj[field] === undefined || obj[field] === '') {
      report('manifestFieldMissing', file, `${label} is missing required field \`${field}\``);
    }
  }
}

function resolveList(value) {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

// ---------------------------------------------------------------- marketplace

const marketplaceFile = join(ROOT, '.claude-plugin', 'marketplace.json');
if (!existsSync(marketplaceFile)) {
  report('pathUnresolved', marketplaceFile, 'marketplace manifest not found');
}

const marketplace = existsSync(marketplaceFile) ? readJson(marketplaceFile) : null;

if (marketplace) {
  requireFields(marketplace, ['name', 'owner', 'plugins'], marketplaceFile, 'marketplace');

  if (marketplace.name && !/^[a-z0-9][a-z0-9-]*$/.test(marketplace.name)) {
    report('manifestFieldMissing', marketplaceFile, `name \`${marketplace.name}\` must be lowercase kebab-case`);
  }

  if (!Array.isArray(marketplace.plugins) || marketplace.plugins.length === 0) {
    report('manifestFieldMissing', marketplaceFile, 'plugins must be a non-empty array');
  }

  for (const entry of marketplace.plugins ?? []) {
    const label = `plugin entry \`${entry.name ?? '(unnamed)'}\``;
    requireFields(entry, ['name', 'description', 'source'], marketplaceFile, label);

    // A `source` object points at another repo; nothing local to check.
    if (typeof entry.source !== 'string') continue;

    const pluginDir = resolve(ROOT, entry.source);
    if (!existsSync(pluginDir) || !statSync(pluginDir).isDirectory()) {
      report('pathUnresolved', marketplaceFile, `${label} source \`${entry.source}\` is not a directory`);
      continue;
    }

    // ---------------------------------------------------------------- plugin

    const pluginFile = join(pluginDir, '.claude-plugin', 'plugin.json');
    if (!existsSync(pluginFile)) {
      report('pathUnresolved', pluginFile, `${label} has no .claude-plugin/plugin.json`);
      continue;
    }

    const plugin = readJson(pluginFile);
    if (!plugin) continue;

    requireFields(plugin, ['name', 'description', 'version'], pluginFile, 'plugin');

    if (plugin.name !== entry.name) {
      report('manifestFieldMissing', pluginFile, `plugin name \`${plugin.name}\` does not match marketplace entry \`${entry.name}\``);
    }
    if (entry.version && plugin.version && entry.version !== plugin.version) {
      report('versionMismatch', pluginFile, `version \`${plugin.version}\` does not match marketplace entry \`${entry.version}\``);
    }
    if (plugin.description && plugin.description.length > MAX_DESCRIPTION_LENGTH) {
      report('descriptionTooLong', pluginFile, `description is ${plugin.description.length} characters`);
    }

    // ---------------------------------------------------------------- skills

    // `skills` is a directory of skills, or an explicit list of skill directories.
    const skillDirs = [];
    for (const declared of resolveList(plugin.skills ?? './skills/')) {
      const path = resolve(pluginDir, declared);
      if (!existsSync(path)) {
        report('pathUnresolved', pluginFile, `skills path \`${declared}\` does not exist`);
        continue;
      }
      // A directory containing SKILL.md is one skill; otherwise it holds many.
      if (existsSync(join(path, 'SKILL.md'))) {
        skillDirs.push(path);
      } else {
        for (const entryName of readdirSync(path, { withFileTypes: true })) {
          if (entryName.isDirectory()) skillDirs.push(join(path, entryName.name));
        }
      }
    }

    if (skillDirs.length === 0) {
      report('pathUnresolved', pluginFile, 'plugin declares no resolvable skills');
    }

    for (const skillDir of skillDirs) {
      const skillFile = join(skillDir, 'SKILL.md');
      const expectedName = skillDir.split('/').pop();

      if (!existsSync(skillFile)) {
        report('pathUnresolved', skillFile, `skill directory \`${expectedName}\` has no SKILL.md`);
        continue;
      }

      const parsed = readFrontmatter(skillFile);
      if (!parsed) {
        report('skillFrontmatterInvalid', skillFile, 'has no closed `---` YAML frontmatter block');
        continue;
      }

      const { fields, body } = parsed;
      if (!fields.name) report('skillFrontmatterInvalid', skillFile, 'frontmatter is missing `name`');
      if (!fields.description) report('skillFrontmatterInvalid', skillFile, 'frontmatter is missing `description`');

      if (fields.name && fields.name !== expectedName) {
        report('skillNameMismatch', skillFile, `frontmatter name \`${fields.name}\` does not match directory \`${expectedName}\``);
      }
      if (fields.description && fields.description.length > MAX_DESCRIPTION_LENGTH) {
        report('descriptionTooLong', skillFile, `description is ${fields.description.length} characters`);
      }
      if (!/##\s+When to Use/i.test(body)) {
        report('skillNoWhenToUse', skillFile, 'has no "When to Use" section to anchor invocation');
      }

      // Every relative path the skill body points at must resolve, or Claude
      // follows a dead reference mid-task.
      const referenced = new Set();
      for (const [, path] of body.matchAll(/`((?:\.\.\/)*[\w.@-]+(?:\/[\w.@-]+)*\.md)`/g)) referenced.add(path);
      for (const [, path] of body.matchAll(/`((?:\.\.\/)+[\w.@-]+(?:\/[\w.@-]+)*\/)`/g)) referenced.add(path);

      for (const path of referenced) {
        if (!existsSync(resolve(skillDir, path))) {
          report('pathUnresolved', skillFile, `references \`${path}\`, which does not exist`);
        }
      }
    }

    // -------------------------------------------------------------- commands

    for (const declared of resolveList(plugin.commands)) {
      const path = resolve(pluginDir, declared);
      if (!existsSync(path)) {
        report('pathUnresolved', pluginFile, `command \`${declared}\` does not exist`);
        continue;
      }
      const parsed = readFrontmatter(path);
      if (!parsed || !parsed.fields.description) {
        report('skillFrontmatterInvalid', path, 'command has no frontmatter `description`');
      }
    }
  }
}

// ------------------------------------------------------- internal-token sweep

for (const file of publishedFiles(ROOT)) {
  // This file necessarily names the tokens it forbids.
  if (file === fileURLToPath(import.meta.url)) continue;

  const text = readFileSync(file, 'utf8');
  for (const token of INTERNAL_TOKENS) {
    const match = text.match(token);
    if (match) {
      const line = text.slice(0, match.index).split('\n').length;
      report('internalLeak', file, `line ${line} contains internal reference \`${match[0]}\``);
    }
  }
}

// ----------------------------------------------------------------- reporting

const errors = problems.filter((p) => p.severity === 'error');
const warnings = problems.filter((p) => p.severity === 'warn');

for (const { severity, file, message } of problems) {
  console.log(`${severity === 'error' ? 'ERROR' : 'warn '}  ${file}: ${message}`);
}

if (errors.length === 0 && warnings.length === 0) {
  console.log('Manifests, skills, and commands all validate.');
} else {
  console.log(`\n${errors.length} error(s), ${warnings.length} warning(s).`);
}

process.exit(errors.length > 0 ? 1 : 0);
