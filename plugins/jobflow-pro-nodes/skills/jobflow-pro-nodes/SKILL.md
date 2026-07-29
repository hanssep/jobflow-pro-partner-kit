---
name: jobflow-pro-nodes
description: Build Node-RED nodes that behave natively in Fiery JobFlow Pro — appearing in the Jobs dashboard with job details, following the file-on-disk message contract, editor UI conventions, i18n and status patterns. Use when creating or reviewing any Node-RED node intended to run inside JobFlow Pro.
---

# Building Node-RED nodes for Fiery JobFlow Pro

JobFlow Pro is a print-workflow product built on Node-RED. A node written for
plain Node-RED loads and runs inside it, but it will not feel like part of the
product: an operator opening a job's details sees a gap where your node ran.

This skill covers what closes that gap. It is self-contained — you need no access
to the JobFlow Pro source, and your package needs no dependency on it.

## When to Use

- Creating a new Node-RED node intended to run inside JobFlow Pro
- Adding JobFlow Pro job tracking to an existing contrib package
- Reviewing a node for JobFlow Pro conformance before publishing

## The reference implementation

A complete, runnable package ships alongside this skill at `../../example-node/`
(relative to this file), with four nodes and a zero-dependency test suite. Read it
before writing anything — everything below exists there in working form.

---

## 1. What makes a node feel native

Four things, in the order an operator notices them:

1. **The job shows your node** — job tracking, section 3
2. **Files travel on disk, not in memory** — the message contract, section 2
3. **Strings are translated** — i18n, section 5
4. **Status reflects reality** — status conventions, section 6

You do not need JobFlow Pro installed to develop. Every integration point is a
no-op when it is absent, so the same package runs on plain Node-RED.

---

## 2. The message contract

JobFlow Pro flows pass **file paths**, not buffers:

| Property | Type | Meaning |
|---|---|---|
| `msg.filepath` | `string \| string[]` | Absolute path to the file being processed |
| `msg.filename` | `string` | Bare file name |
| `msg.jobflow` | `object` | The job this message belongs to |

Rules:

- **Read from `msg.filepath`, write to disk, pass the path on.** Do not load a
  print-sized PDF into memory to hand it to the next node.
- **`msg.filepath` may be an array** when an upstream node produced several files.
  Handle it or reject it explicitly. Silently processing element zero and dropping
  the rest loses a customer's work.
- **`msg.jobflow` may also be an array** when a job was fanned out. Decline that
  case rather than guessing which element you were meant to record against.
- **Append to `msg.jobflow.flow`. Treat every other field as read-only.** JobFlow
  Pro owns `jobID`, `flowName`, `source` and the rest; writing to them can corrupt
  the job record.

```ts
if (Array.isArray(msg.filepath)) throw new Error('This node handles one file at a time.');
const filePath = msg.filepath;
if (typeof filePath !== 'string' || !fs.existsSync(filePath)) {
  throw new Error('No input file on the message.');
}
```

---

## 3. Job tracking

### How it actually works

A JobFlow Pro job carries its own history as an array of steps on
`msg.jobflow.flow`. Whenever a JobFlow Pro node reports progress, it writes that
**entire array** to the job record.

So a step your node appends is picked up and stored by the next JobFlow Pro node
that runs after yours. That is the whole mechanism, and it is why this needs no
dependency, no install step, and no changes to JobFlow Pro.

### What follows from that

Three consequences you must design around:

- **Your node cannot start a job.** Jobs are created by JobFlow Pro input nodes —
  a hot folder or a drop zone. Place your nodes downstream of one.
- **At least one JobFlow Pro node must run after yours**, or your step is never
  saved. In practice `flow-end` at the end of the flow is enough. Say this in
  your node's help text.
- **There is no live progress.** Your step appears when a later JobFlow Pro node
  reports, not while your node is working. Do not promise a progress indicator
  you cannot deliver.

### Recording a step

```ts
import { beginStep, endStep, failStep } from './lib/jobflow';

const step = beginStep(msg, 'Transform');   // before the work
try {
  const output = await doTheWork(msg.filepath);
  endStep(step, { outputFilePath: output, properties: { pages: '3' } });
  send(msg);
  done();
} catch (err) {
  failStep(msg, step, `Transform failed: ${err.message}`);
  done(err);
}
```

Call `beginStep` **before** the work so the step records which file your node
received even when the work then fails. All three helpers no-op when there is no
job, so this same code runs unchanged on plain Node-RED.

### The step shape

| Field | Notes |
|---|---|
| `name` | Shown as the step title. **Prefix it with your product name.** |
| `inputFilePath` | The file your node received |
| `outputFilePath` | The file your node produced, if any |
| `properties` | Key/value pairs shown under the step. Plain strings. |
| `error` | A **JSON string** — see below |
| `time` | ISO 8601. Always set it; the dashboard reads it. |

**Never name a step exactly `flow-end`.** The dashboard filters that string out of
the timeline, so such a step silently vanishes. Prefixing your names avoids this
and stops you impersonating a built-in step.

### Errors must be JSON strings

The dashboard does `JSON.parse(step.error)` and reads `.error` from the result:

```ts
step.error = JSON.stringify({ error: 'File is 900 bytes, over the 500 byte limit.' });
```

Plain text throws inside the dashboard's parser. The step then renders with an
**empty** error badge — the operator sees that something failed but not what,
which is worse than useless under production pressure.

Use a plain English sentence. Your package has no entry in the dashboard's
translation catalogue, so a translation key would be shown literally.

Setting `msg.jobflow.error` as well marks the whole job failed, so the failure
shows in the Jobs list and not only inside job details. `failStep` in the example
does both.

### Business failures are not errors

A file that fails your validation is an expected outcome. Record it against the
job and route the message out a failure output — do not raise a Node-RED error.
Reserve errors for genuine faults, like a missing input file. `jfpdemo-validate`
in the example shows the difference.

### Keep it JSON-safe

The history is serialized into the job record and parsed back out. Anything not
JSON-safe — a Buffer, a Date, a circular reference, a function — is lost or
corrupts the record. Strings and plain objects only.

---

## 4. Package layout

TypeScript compiled to `dist/`, one directory per node:

```
src/
  jobflow.types.ts              copied from the example package
  lib/jobflow.ts                the step helpers
  nodes/
    transform/
      Transform.ts              runtime
      Transform.html            editor template
      locales/en-US/
        Transform.json          strings
        Transform.html          help
test/                           node --test, no dependencies
package.json
tsconfig.json
```

```json
{
  "node-red": {
    "version": ">=4.0.9",
    "nodes": { "yourpkg-transform": "./dist/nodes/transform/Transform.js" }
  }
}
```

Node-RED finds `Transform.html` and `locales/` **beside the compiled `.js`**, so
your build must copy them into `dist`. `tsc` emits only JavaScript — see
`scripts/copy-assets.js` in the example for a dependency-free copy step.

Prefix node type names (`yourpkg-transform`) so they cannot collide in the palette.

---

## 5. Internationalisation

**Every visible string comes from a locale file.** No inline English in the editor
template, no hardcoded strings in `node.status()`.

```json
{
  "yourpkg-transform": {
    "label":       { "name": "Name", "suffix": "Appended text" },
    "placeholder": { "suffix": "Text appended to the file" },
    "tips":        { "placement": "Place after a hot folder or drop zone." },
    "status":      { "working": "Transforming...", "done": "Transformed" },
    "error":       { "transformFailed": "Transform failed" }
  }
}
```

The top-level key **must** equal the registered node type.

```html
<span data-i18n="yourpkg-transform.label.name"></span>
<input data-i18n="[placeholder]yourpkg-transform.placeholder.suffix" />
```

In the runtime, pass the **key** to `node.status()` — Node-RED translates it:

```ts
node.status({ fill: 'blue', shape: 'dot', text: 'yourpkg-transform.status.working' });
```

Help goes in `locales/<lang>/<Node>.html`, never inline in the editor template:

```html
<script type="text/markdown" data-help-name="yourpkg-transform">
# Transform
## What This Does
...
</script>
```

Note the asymmetry: node **status** text is translated through your locale files,
but the **job history** text you write in section 3 is not — that goes to a
dashboard which has no catalogue for your package. Status takes keys; job history
takes plain English.

---

## 6. Status conventions

Operators read node status at a glance across a whole canvas:

| State | Colour | Shape |
|---|---|---|
| Working | `blue` | `dot` |
| Succeeded | `green` | `dot` |
| Failed | `red` | `dot` |
| Rejected / non-fatal | `yellow` | `ring` |
| Inactive | `grey` | `ring` |

Clear status on close:

```ts
node.on('close', () => { node.status({}); });
```

---

## 7. Editor UI

JobFlow Pro's editor is Node-RED's, themed. Match Node-RED's own structures and
your node looks native automatically.

```html
<div class="form-row">
  <label for="node-input-name">
    <i class="fa fa-tag"></i> <span data-i18n="yourpkg-transform.label.name"></span>
  </label>
  <input type="text" id="node-input-name"
         data-i18n="[placeholder]yourpkg-transform.placeholder.name" />
</div>
```

- Use `.form-row`, `.form-tips` and `node-input-<property>` ids — Node-RED styles
  them for you
- Use Font Awesome icons already bundled with Node-RED (`fa fa-tag`)
- Brand blue is `#007FDA`. Keep one colour across your whole palette.
- **Never hardcode text or background colours.** Use Node-RED's CSS custom
  properties (`--red-ui-primary-text-color`, `--red-ui-secondary-background`) so
  your node follows the editor's light and dark themes.
- Label multiple outputs with `outputLabels` so the canvas explains itself
- Progressive disclosure: show common options, hide advanced ones. Print operators
  work under time pressure.

---

## 8. Conformance checklist

- [ ] Node type names are prefixed and cannot collide
- [ ] `msg.filepath` is read defensively, including the array case
- [ ] `msg.jobflow` array case is declined, not guessed at
- [ ] Only `msg.jobflow.flow` is written to; other fields are left alone
- [ ] Step names are prefixed and never exactly `flow-end`
- [ ] `beginStep` runs before the work, not after
- [ ] `step.error` is `JSON.stringify({ error: '...' })`, in plain English
- [ ] Business failures route to an output; only faults raise node errors
- [ ] Everything written into the history is JSON-safe
- [ ] Help states that a JobFlow Pro node must run later in the flow
- [ ] Every visible string is in a locale file, keyed by node type
- [ ] Status colours follow section 6 and are cleared on close
- [ ] `dist/` has the `.html` and `locales/` beside each `.js`
- [ ] The package loads and works on plain Node-RED

---

## 9. Anti-patterns

| Do not | Why | Instead |
|---|---|---|
| Write to `msg.jobflow.jobID` or other fields | JobFlow Pro owns them; you can corrupt the job | Append to `.flow` only |
| Try to create a job | Only JobFlow Pro input nodes can | Sit downstream of a hot folder or drop zone |
| Put a plain sentence in `step.error` | The dashboard's `JSON.parse` throws; badge renders empty | `JSON.stringify({ error: '...' })` |
| Put an i18n key in `step.error` | No catalogue entry for your package | Plain English |
| Name a step `flow-end` | Filtered out of the timeline; it vanishes | Prefix every step name |
| Promise live progress | Steps save only when a later JobFlow Pro node reports | Describe it accurately in help |
| Throw when `msg.jobflow` is absent | Breaks your package on plain Node-RED | Let the helpers no-op |
| Raise a node error for a rejected file | Business outcomes are not faults | Route it to a failure output |
| Put file contents in `msg.payload` | Print files are large | Write to disk, pass the path |
| Hardcode editor colours | Breaks the dark theme | Node-RED CSS custom properties |
