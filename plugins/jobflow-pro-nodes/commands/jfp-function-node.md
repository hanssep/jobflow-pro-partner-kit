---
description: Write or review JavaScript for a Node-RED Function node in a JobFlow Pro flow
argument-hint: [what the function should do]
---

Write, review, or debug the JavaScript inside a Node-RED **Function node** running
in a JobFlow Pro flow.

## Before you write anything

1. **Load the `jobflow-pro-node-craft` skill** and read
   `${CLAUDE_PLUGIN_ROOT}/skills/jobflow-pro-node-craft/references/function-node-js.md`
   in full. It documents what is actually in the sandbox, verified against
   Node-RED 4.0.9. Do not write from general Node.js knowledge — `require`,
   `process`, `fs` and `fetch` do not exist in there, and several of the traps
   fail silently.
2. **If the function will record anything in the job**, also load the
   `jobflow-pro-nodes` skill for the step contract (section 3) — the step shape,
   the JSON-string error format, and the prefixing rule all apply identically to
   function code.

## What to establish with the user

Ask only what you cannot infer from `$ARGUMENTS` or the flow:

- **What the function does** — and whether one input message produces one round
  of output, or output over time.
- **How many outputs** the node has, and what routes where.
- **Whether it sits in a JobFlow Pro job flow** — i.e. is there a `msg.jobflow`
  to respect and possibly record against.
- **Whether it needs anything external** — an npm package or built-in module
  (that is the Setup tab, not `require`), or a network call.

## Pick the shape first

The completion model follows from this choice, so make it deliberately:

| The work is | Write it as |
|---|---|
| Synchronous — reshape, branch, compute | Mutate `msg`, `return msg`. No `node.done()`. |
| Asynchronous and awaitable | Top-level `await`, then `return msg`. The wrapper is async, so **no `node.done()`** — this is the simplest correct pattern. |
| A callback API you cannot await | `node.send()` + `node.done()` on **every** path, errors included. |
| One message in, many out | Build an array, `RED.util.cloneMessage` each copy, `return [out]` for array-per-output. |
| Output spread over time | Repeated `node.send()` — and clone, because separate calls deliver by reference. |

Never mix: one real `node.done()` call anywhere disables auto-completion for the
entire function, so every path must then call it or the message never completes.

## Recording a step from function code

A Function node cannot import the kit's `lib/jobflow.ts` helpers, so inline the
step. The mechanism is unchanged — append to `msg.jobflow.flow` and the next
JobFlow Pro node persists the whole array:

```js
// Decline the fan-out case rather than guessing which job to record against.
const job = Array.isArray(msg.jobflow) ? null : msg.jobflow;

let step = null;
if (job) {
  if (!Array.isArray(job.flow)) job.flow = [];
  step = {
    name: 'Your Product: Reshape',        // prefixed; never exactly 'flow-end'
    time: new Date().toISOString(),       // the dashboard reads this
  };
  if (typeof msg.filepath === 'string') step.inputFilePath = msg.filepath;
  job.flow.push(step);                    // push BEFORE the work
}

try {
  msg.payload = await doTheWork(msg.payload);
  if (step) step.properties = { items: String(msg.payload.length) };
  return msg;
} catch (err) {
  if (step) {
    // A JSON string in plain English — the dashboard JSON.parses this and
    // renders an empty error badge if it is anything else.
    step.error = JSON.stringify({ error: `Reshape failed: ${err.message}` });
    job.error = step.error;               // also marks the whole job failed
  }
  throw err;
}
```

Guard on `job` throughout so the same code still runs outside a JobFlow Pro job.

## Non-negotiables

Check these against what you produced — most fail silently:

- Never `return { payload: x }`. That destroys `msg.jobflow`, `msg.filepath` and
  everything upstream attached. Mutate the message you received.
- No `require`. Modules come from the Setup tab, as a variable name.
- `node.error(text, msg)` — the two-argument form. One-arg is invisible to Catch
  nodes.
- Clone with `RED.util.cloneMessage` before reusing or duplicating a message; the
  first delivery of every call is by reference.
- Business outcomes route to an output; only genuine faults raise errors.
- Context values are JSON-safe — no `Map`, class instance or Buffer.
- Step names are prefixed and never exactly `flow-end`; `step.error` is
  `JSON.stringify({ error: '...' })`.
- The node's timeout setting does not bound an `await`. Race the call against a
  timer if it talks to a service.

## Verify — and be honest about what you cannot

There is no build step for a Function node, so there is less to lean on than
with a custom node. Do what can actually be done:

1. **Walk the anti-patterns table** at the end of `function-node-js.md`
   row by row against your code. Report it as checked, not assumed.
2. **If the logic is non-trivial, extract and test it.** Pure decision or
   transform logic belongs in a plain function you can run under `node --test`
   outside Node-RED — the same split the example package uses for
   `src/lib/route-rules.ts`. Offer this; do not silently skip it because the
   code lives in a dialog.
3. **State what needs the live editor.** Whether it deploys, whether a Setup-tab
   module resolves on the target install, and whether the step renders in the
   Jobs dashboard are all unverified until someone runs it. Say so plainly.

## When to stop writing function code

If any of these is true, say so and offer `/jfp-new-node` instead:

- The same code is about to be pasted into a second flow
- It needs configuration a user should edit in a dialog — especially a
  credential, which a Function node cannot store encrypted
- It needs translated strings, help text, or a palette identity
- It spawns a process or holds a connection whose cleanup must survive redeploy
- It should ship to other JobFlow Pro installs as a package
