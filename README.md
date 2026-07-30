# JobFlow Pro partner kit

Claude Skills for building Node-RED nodes that behave natively in **Fiery
JobFlow Pro** — appearing in the Jobs dashboard with full job details, following
the file-on-disk message contract, and matching the product's editor conventions.

Install the plugin and your Claude writes conformant nodes. You need no access to
the JobFlow Pro source, and your package takes no dependency on it.

**Requires zero changes to JobFlow Pro.** Nothing here depends on a product
release, a plugin, or a version. It works against JobFlow Pro as it ships today.

## Install

```
/plugin marketplace add hanssep/jobflow-pro-partner-kit
/plugin install jobflow-pro-nodes@jobflow-pro-partner-kit
```

Then `/jfp-new-node watermark` to scaffold a conformant node, or
`/jfp-function-node` for the JavaScript inside a Function node. Or just describe
what you want to build — the skills load themselves when the task calls for them.

## What you get

| | |
|---|---|
| **`jobflow-pro-nodes`** skill | The JobFlow Pro integration contract: job tracking, the step shape, the message contract, i18n, status colours, editor UI, a conformance checklist, and the anti-patterns. |
| **`jobflow-pro-node-craft`** skill | The Node-RED craft underneath that contract — ten silent failure modes, plus reference files on runtime patterns, editor patterns, and function-node JavaScript. Standard Node-RED behaviour, verified against 4.0.9. |
| **`/jfp-new-node`** command | Scaffolds a node from the reference package and walks both checklists. |
| **`/jfp-function-node`** command | Writes or reviews the JavaScript inside a Function node, including how to record a job step without the helper library. |
| **`example-node/`** | A complete, runnable package: four nodes, a zero-dependency test suite, an importable example flow, and the files you copy into your own repo. |

The example package lives at
[`plugins/jobflow-pro-nodes/example-node`](plugins/jobflow-pro-nodes/example-node).
It builds and tests with no network beyond `npm install`:

```bash
cd plugins/jobflow-pro-nodes/example-node
npm install && npm run build && npm test
```

## What your node gets

The Jobs dashboard shows your node as a step in the job details. The step has the
name, the start time and the end time, the input and output files, the
properties, and the errors.

The kit does not give you more than this. Your node reads the message, and it
writes to the message. It does not connect to a JobFlow Pro service. It does not
need a credential, an API key, or an agreement with Fiery.

## How it works

A JobFlow Pro job carries its history as an array on `msg.jobflow.flow`. Every
time a JobFlow Pro node reports progress it writes that whole array to the job
record. Your node appends a well-formed step to the array, and the next JobFlow
Pro node in the flow persists it.

This is the complete method. It uses only the data that is already on the
message. This is why JobFlow Pro needs no change.

## What you publish

You publish your own npm package to the public npm registry, the same as any
other `node-red-contrib-*` package. The JobFlow Pro package manager installs it
with the same method that it uses for community packages. Your customer does no
extra work. Your package needs no catalogue entry, no private registry, and no
allowlist entry.

## The limits

These follow directly from the mechanism above and are not oversights:

| Limit | Consequence |
|---|---|
| **A partner node cannot start a job** | It must sit downstream of a hot folder or drop zone. Input-style nodes — mailbox pollers, webhooks, queue consumers — can do their work, but a JobFlow Pro input node has to create the job. |
| **A JobFlow Pro node must run after yours** | Otherwise the step is never written. `flow-end` at the end of the flow is enough. |
| **No live progress** | Your step appears when a later JobFlow Pro node reports, not while your node is working. A long-running node leaves the job reading as its previous state meanwhile. |
| **The step shape is JobFlow Pro's own format** | `msg.jobflow.flow` entries follow an internal structure. If it changes, packages built against this kit need updating — watch this repository's releases. |

### Starting a job

The first limit is the one most integrations hit, since input nodes are where
they usually begin. The way round it today, with zero product change: **a hot
folder.** Your node writes into a watched folder and JobFlow Pro creates the job
from it. That needs nothing at all, but it splits the work into two flows, so no
message context carries across the boundary.

## Verified

- **The plugin installs and both skills register in Claude Code** (2026-07-29)
- The example package builds; all four nodes were exercised in a live
  Node-RED 4.0.9 editor, installed from the packed tgz: palette, edit dialogs,
  the router's rule round-trip and dynamic output count, the `examples/` flow
  import, live routing with interpolated status, and the config node's
  test-connection route — both the pre-deploy "deploy first" path and real
  reachable/refused results
- 15 tests pass (`npm test`, no dependencies) covering the step shape, the
  JSON-string error format the dashboard parses, the no-op paths outside
  JobFlow Pro, a serialization round trip, and the router's rule matching
- Step shape and error format were checked against the dashboard's own
  job-details parsing logic
- **Verified end to end on a live JobFlow Pro install** (2026-07-29): the example
  package was installed on a running instance and a flow of
  `hot folder → partner node → flow-end` processed a real file — the partner step
  rendered in the job's details in the dashboard

## Repository layout

```
.claude-plugin/marketplace.json      the marketplace manifest
plugins/jobflow-pro-nodes/
  .claude-plugin/plugin.json         the plugin manifest
  skills/jobflow-pro-nodes/          the integration contract
  skills/jobflow-pro-node-craft/     Node-RED craft + 3 reference files
  commands/jfp-new-node.md           the scaffold command
  commands/jfp-function-node.md      the Function node command
  example-node/                      the runnable reference package
scripts/validate-manifests.mjs       CI check on manifests and skills
```

## Contributing

`node scripts/validate-manifests.mjs` checks the manifests, skill frontmatter,
and every referenced path. CI runs it along with the example package's build and
tests on every push.

## License

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 Fiery LLC.

Fiery and JobFlow Pro are trademarks of Fiery LLC. This kit is documentation and
example code for building against JobFlow Pro; it is not the product and contains
no part of it.
