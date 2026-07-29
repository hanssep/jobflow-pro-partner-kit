---
description: Scaffold a JobFlow Pro-conformant Node-RED node from the reference example
argument-hint: [node name, e.g. "watermark"]
---

Scaffold a new Node-RED node that conforms to the JobFlow Pro integration
contract, using the reference package that ships with this plugin as the source
of truth.

## Before you write anything

1. **Load both skills.** `jobflow-pro-nodes` is the integration contract;
   `jobflow-pro-node-craft` is the Node-RED craft underneath it. Do not scaffold
   from memory of Node-RED conventions — the traps in the craft skill fail
   silently and this is exactly where they get baked in.
2. **Read the reference package** at `${CLAUDE_PLUGIN_ROOT}/example-node/`. The
   files you are about to generate all exist there in working form. Read at
   minimum:
   - `src/jobflow.types.ts` — the message contract
   - `src/lib/jobflow.ts` — the step helpers
   - `src/nodes/transform/` — the simplest complete node (runtime, editor
     template, locales)
   - `scripts/copy-assets.js` — why `dist/` needs a copy step
   - `test/jobflow.test.js` — what is worth pinning with a test
3. **Establish where you are.** If the current directory is not already a
   Node-RED package (no `package.json` with a `node-red` key), you are
   bootstrapping a new package — say so and confirm the target directory before
   creating files.

## What to establish with the user

Ask only for what you cannot infer, in one round:

- **Node name** — `$1` if given. Derive the type name as
  `<pkgprefix>-<name>` (lowercase, hyphenated) and the class/file name in
  PascalCase.
- **Package prefix** — infer from an existing `package.json` `node-red.nodes`
  keys if the package already has nodes; otherwise ask. Every node type name in
  a package shares one prefix so it cannot collide in the palette.
- **Step prefix** — the product name shown in job history (`STEP_PREFIX` in
  `lib/jobflow.ts`). Infer from the package name; confirm it reads well to a
  print operator, because it is what they see in the Jobs dashboard.
- **What the node does** — enough to know whether it produces an output file,
  whether it has a business-failure path needing a second output, and whether
  its output count is fixed.

Do not ask about anything the contract already decides: file paths travel on
`msg.filepath`, strings live in locale files, status colours follow the table in
the skill.

## What to generate

For a package that already exists, add only the node. For a new package,
bootstrap it from the reference layout.

```
src/
  jobflow.types.ts              copied verbatim from the reference package
  lib/jobflow.ts                copied, with STEP_PREFIX changed
  nodes/<name>/
    <PascalName>.ts             runtime
    <PascalName>.html           editor template — IIFE-wrapped
    locales/en-US/
      <PascalName>.json         every visible string, keyed by node type
      <PascalName>.html         help text
test/<name>.test.js             node --test, no dependencies
package.json                    node-red.nodes entry pointing into dist/
tsconfig.json
scripts/copy-assets.js          copied verbatim
```

Register the node in `package.json` under `node-red.nodes`, pointing at the
**compiled** path (`./dist/nodes/<name>/<PascalName>.js`).

## Non-negotiables for the generated code

These are the ones that fail silently, so verify each in what you produced
rather than trusting that you followed them:

- `beginStep` is called **before** the work, so a failure still records which
  file arrived
- `step.error` is `JSON.stringify({ error: '...' })` in plain English — never a
  bare sentence, never an i18n key
- The step name is prefixed and is never exactly `flow-end`
- `msg.filepath` is checked for the array case; `msg.jobflow` array case is
  declined rather than guessed at
- Nothing is written to `msg.jobflow` except appending to `.flow`
- No code path builds a fresh `msg` object — mutate and pass on the one received
- The editor `<script>` is wrapped in an IIFE
- Locale placeholders use `__var__`, never `{{var}}`
- A config node's template uses `node-config-input-*` ids, not `node-input-*`
- Any `RED.httpAdmin` route has `RED.auth.needsPermission(...)`; the editor calls
  it with a relative URL
- Node status text passes a **key** to `node.status()`; job-history text is plain
  English
- The help text states that a JobFlow Pro node must run later in the flow

## Then verify, do not assume

1. `npm run build` — must succeed, and `dist/nodes/<name>/` must contain the
   `.html` and `locales/` beside the `.js`. Check that; a missing copy step is
   invisible until Node-RED shows an unstyled dialog with raw i18n keys.
2. `npm test` — must pass.
3. Walk the conformance checklist in `jobflow-pro-nodes` §8 and the craft
   checklist in `jobflow-pro-node-craft` explicitly, item by item, and report
   which ones you verified versus which need a running editor to confirm.
4. State plainly what has **not** been verified. Loading in a real Node-RED
   editor and appearing correctly in a real JobFlow Pro Jobs dashboard are
   separate checks that a passing build does not cover.
