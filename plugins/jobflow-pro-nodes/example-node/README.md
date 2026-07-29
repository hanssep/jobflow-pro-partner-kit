# @example/node-red-contrib-jfp-demo

A complete, runnable Node-RED package showing how a third-party package appears in
the Fiery JobFlow Pro Jobs dashboard.

No dependency on JobFlow Pro, no install step beyond your own package, and no
changes to the product.

| Node | Shows |
|---|---|
| `jfpdemo-transform` | The core pattern: record a step, attach the output file and properties, report failure |
| `jfpdemo-validate` | A business outcome — reject a file, mark the job failed, route it out a second output without raising a node error |
| `jfpdemo-server-config` | A config node holding a host/port and an API key credential, plus an admin `needsPermission`-gated route the editor calls to test the connection for real |
| `jfpdemo-route` | A node whose output count is driven by its own configuration — TypedInput property resolution, and safely fanning one message out to several outputs with `cloneMessage` |

Try `jfpdemo-route` without wiring anything up yourself: **Import → Examples → @example/node-red-contrib-jfp-demo → route-demo** loads a ready-to-run flow (`examples/route-demo.json`).

## Build and test

```bash
npm install
npm run build
npm test
```

The tests use Node's built-in runner, so there is nothing extra to install. They
assert the shape of what gets written into the job history — including that the
error field survives the `JSON.parse` the dashboard performs on it.

## Try it

```bash
npm install -g node-red
cd ~/.node-red && npm install /path/to/example-node
node-red
```

On plain Node-RED, wire `inject → transform → debug`: the node does its work and
records nothing.

Inside JobFlow Pro, wire `hot folder → transform → flow-end`. Open the job in the
Jobs dashboard and the transform step is in its history.

## How job tracking works here

A JobFlow Pro job carries its history on `msg.jobflow.flow`. Each JobFlow Pro node
writes that whole array to the job record when it reports progress — so a step
this package appends is saved by the next JobFlow Pro node in the flow.

Three things follow:

- **This package cannot start a job.** Put its nodes after a hot folder or drop zone.
- **A JobFlow Pro node must run afterwards**, or the step is never saved. `flow-end` does it.
- **Steps are not live.** They appear when a later JobFlow Pro node reports.

## What to copy into your own package

| File | Why |
|---|---|
| `src/jobflow.types.ts` | The message contract. Copy verbatim. |
| `src/lib/jobflow.ts` | The step helpers. Change `STEP_PREFIX` to your own product name. |
| `src/lib/route-rules.ts` | The pattern for keeping matching/decision logic Node-RED-free and unit-testable. |
| `scripts/copy-assets.js` | Dependency-free step to get `.html` and locales into `dist`. |
| `test/jobflow.test.js` | Adapt — it pins the details that are easy to get silently wrong. |

## The integration in four lines

```ts
const step = beginStep(msg, 'Transform');        // no-op outside JobFlow Pro
const output = await doTheWork(msg.filepath);
endStep(step, { outputFilePath: output, properties: { pages: '3' } });
send(msg);
```

See the `skills/` directory alongside this package for the full conventions —
`jobflow-pro-nodes` for the integration contract, `jobflow-pro-node-craft` for the
Node-RED craft underneath it.

## License

MIT. Copyright (c) 2026 Fiery LLC. See the LICENSE file at the repository root.
