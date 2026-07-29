/**
 * Copy the non-TypeScript parts of a node next to its compiled JavaScript.
 *
 * Node-RED loads a node's editor template and locale files by looking beside the
 * .js file it was pointed at, so `Transform.html` and `locales/` have to land in
 * dist alongside `Transform.js`. tsc only emits .js, hence this step.
 *
 * Deliberately dependency-free: one less thing for a consumer of this example to
 * install, and one less thing to keep up to date.
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const DIST = path.join(__dirname, '..', 'dist');
const COPY_EXTENSIONS = new Set(['.html', '.json']);

let copied = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const from = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(from);
      continue;
    }
    if (!COPY_EXTENSIONS.has(path.extname(entry.name))) continue;

    const to = path.join(DIST, path.relative(SRC, from));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    copied++;
  }
}

if (!fs.existsSync(DIST)) {
  console.error('dist/ does not exist — run tsc first.');
  process.exit(1);
}

walk(SRC);
console.log(`Copied ${copied} asset file(s) into dist/.`);
