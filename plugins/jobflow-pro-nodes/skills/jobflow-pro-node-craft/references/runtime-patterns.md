# Runtime patterns

How to write the runtime (`.js`/`.ts`) side of a node so it survives
production: input handling, cleanup, external tools, files on disk, and
context. Verified against Node-RED 4.0.9, the version JobFlow Pro embeds.

---

## 1. The input handler

Use the three-argument form and treat `done` as a contract: **called exactly
once per message, on every path.**

```ts
node.on('input', async (msg, send, done) => {
  try {
    const result = await doTheWork(msg);
    msg.payload = result;
    send(msg);
    done();
  } catch (err) {
    done(err as Error);   // routes to Catch nodes, marks the node errored
  }
});
```

- `done(err)` is for **faults** — missing input file, tool crashed, contract
  broken. It feeds Catch nodes and error tracking.
- **Business outcomes are not faults.** A file that fails your check is an
  expected result: route it out a dedicated output (`send([null, msg])`) and
  call `done()` with no argument. The companion skill covers how this
  interacts with job tracking.
- Never call both `done(err)` and route the same message onward — pick one
  meaning per path.
- If early returns multiply, a `finally { done(); }` keeps the contract
  honest — but then no path may also call `done(err)`; throw instead and
  convert once in `catch`.

### Multiple outputs

`send` takes an array, one slot per output; `null` skips a slot:

```ts
send([msg, null]);        // first output
send([null, msg]);        // second output
```

Label every output with `outputLabels` in the editor so the canvas explains
itself.

## 2. Send and clone semantics

The object you pass to `send()` is what the first receiver gets — by
reference. Within one `send()` call the runtime deep-clones every delivery
after the first (the same object in two output slots, or one output wired to
two nodes, arrives as independent copies). Across **separate** `send()`
calls, nothing is cloned for you.

Consequences:

- **Do not mutate `msg` after `send(msg)`.** The first receiver is working on
  that same object.
- **The repeated-send fan-out pattern requires explicit clones.** Each call
  delivers its message by reference; two of them sharing a nested object stay
  entangled — mutating one mutates the other, wires apart, silently:

```ts
for (const item of items) {
  const m = RED.util.cloneMessage(msg);
  m.payload = item;
  send(m);
}
```

- A shallow spread (`{ ...msg }`) is **not** a clone — nested objects like
  `msg.jobflow` are still shared. Use `RED.util.cloneMessage`.

## 3. The close handler

`node.on('close', (removed, done) => { ... })` runs on redeploy and on
delete. (`removed` distinguishes the two; most nodes never need it.) The
handler's job: release **everything the node created, and nothing it
didn't.**

```ts
const onEvent = (data) => { /* ... */ };     // named, so it can be removed
emitter.on('event', onEvent);

node.on('close', async (_removed: boolean, done: () => void) => {
  clearTimeout(pollTimer);                   // 1. timers
  await watcher?.close();                    // 2. watchers / servers / sockets
  emitter.removeListener('event', onEvent);  // 3. listeners — impossible if anonymous
  for (const job of activeJobs) {            // 4. in-flight external work
    await abortQuietly(job);
  }
  inFlight.clear();                          // 5. dedupe/claim sets
  done();                                    // 6. last
});
```

Hard rules learned the expensive way:

- **Register listeners as named functions.** An inline arrow passed to
  `.on()` can never be `removeListener`ed; every redeploy stacks another
  copy.
- **Track long-running external work** (spawned processes, remote jobs,
  uploads) in an instance-level array so close can abort it. Untracked work
  outlives the node and writes into a world that has moved on.
- **Never delete or mutate external resources you don't own** — user folders,
  shared configuration, another node's data — just because you have a path to
  them. Close releases *your* state; it does not tidy the world.
- **Guard finalization against double-execution.** When both an error path
  and a close-triggered abort can finalize the same piece of work, set a
  claimed flag before finalizing and check it first. Two "final" writes to
  the same record corrupt it.

## 4. Concurrency control

External tools and print-sized files punish unbounded parallelism. Serialize
or cap concurrent work per node with a queue. A dependency-free serial queue:

```ts
let queue: Promise<void> = Promise.resolve();
let depth = 0;

node.on('input', (msg, send, done) => {
  depth++;
  queue = queue
    .then(() => handle(msg, send))          // one message at a time
    .then(() => done(), done)
    .finally(() => { depth--; });
});
```

Two caveats that matter in production:

- **A queue throttles execution, not inflow.** Every arriving message still
  enqueues immediately; a fast upstream can build an unbounded backlog with
  no backpressure signal. Node-RED has no built-in backpressure across wires.
  Watch the depth — surface it in `node.status`, warn past a threshold, and
  decide explicitly what "too many" means for your node.
- Scope the queue correctly: per node instance when instances are
  independent, module-scoped when all instances share one external resource
  (one license, one device).

## 5. Spawning external tools

**Settle which binary, and on whose licence, before writing any of this.** A
tool already installed on the machine is not available to you merely because it
is there — see *External tools* in the **jobflow-pro-nodes** skill. What follows
assumes you have the right to run the thing you are spawning.

The standard shape — `spawn`, accumulate output, and treat the two failure
modes separately:

```ts
import { spawn } from 'child_process';
import kill from 'tree-kill';

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    let stdout = '', stderr = '', finished = false;

    const timer = setTimeout(() => {
      finished = true;
      kill(child.pid!, 'SIGTERM');
      reject(new Error(`${cmd} timed out after ${timeoutMs} ms`));
    }, timeoutMs);

    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', err => {              // spawn itself failed: binary missing, EPERM
      clearTimeout(timer);
      if (!finished) reject(err);
    });
    child.on('close', code => {             // process ran and exited
      clearTimeout(timer);
      if (!finished) resolve({ code, stdout, stderr });
    });
  });
}
```

- **`error` and `close` are different failures.** `error` means the process
  never ran (not found, not executable); `close` gives you an exit code.
  Handle both or one of them becomes an unhandled rejection.
- **Always set a timeout that kills the child.** A hung tool otherwise holds
  its queue slot forever. A timeout is a **failure** — never let a timeout
  path fall through to the success path.
- **Kill process trees, not processes.** `child.kill()` signals only the
  direct child; CLI wrappers that shell out again leave orphaned
  grandchildren, especially on Windows. Use the `tree-kill` package.
- **Treat exit codes as a documented, tested contract.** Tools have
  surprising conventions (0 = match, 1–100 = degrees of difference, >100 =
  real failure is a real example). Put the mapping in a small pure function
  with unit tests, verify it against a live run of the tool, and date the
  verification in a comment. Inline `if (code === 0)` guesses are where
  "timeout reported as success" bugs live.
- Write tool input/output to unique temp files, and delete them in a
  `finally`. Before shipping, audit every `finally` for cleanup that was
  commented out "temporarily" during debugging.

## 6. Files on disk

- **Atomic writes: write a `.tmp` sibling, then rename over the target.**
  Rename on the same volume is atomic; a concurrent reader sees the old file
  or the new one, never a half-written one.

```ts
fs.writeFileSync(target + '.tmp', data);
fs.renameSync(target + '.tmp', target);
```

- **Rename doubles as a lock-free claim.** To let exactly one worker claim a
  file, rename it from `pending/` to `processing/` — the filesystem
  guarantees only the first caller's rename succeeds; a thrown rename means
  someone else won. No lock files, no races.
- **"File exists" does not mean "file is finished."** A watcher fires while
  the writer is still flushing. Check stability before processing: `stat`
  twice a second apart and compare size *and* mtime, then try opening `'r+'`
  — on Windows a still-locked file throws `EPERM`/`EBUSY`/`EACCES` even when
  its size has stopped changing. Require several consecutive stable checks
  for large files arriving over a network.
- **Retry transient Windows lock errors with backoff, bounded, then fail
  loud.** Antivirus scanners and the writing process hold locks briefly;
  `EBUSY`/`EPERM`/`EACCES` on delete or copy usually clear within seconds.
  Retry a bounded number of times — and when the bound is exhausted, raise a
  real error rather than logging and limping on.
- **Guard against double-processing.** A node that both watches and polls (or
  receives duplicate events) needs an in-flight `Set` of paths it is
  currently processing, cleared on completion and on close.

## 7. Context: node, flow, global

| Scope | Visible to | Survives |
|---|---|---|
| `node.context()` | this node instance | redeploy of other nodes |
| `.flow` | nodes on the same tab | until flow restart |
| `.global` | every node | until Node-RED restart |

Rules:

- **Never put per-message or per-job data in flow or global context.**
  Concurrent messages clobber each other's state. Data that belongs to a
  message travels *on* the message.
- **Store only JSON-safe values.** Context can be configured to persist to
  disk; a `Map`, a function, a live class instance, or a `Buffer` will not
  survive the serialization round trip — it silently becomes `{}` or
  garbage.
- **Store paths, not payloads.** Large data goes to a file on disk; context
  holds the path.
- Module-scope caches (a `const cache = new Map()` at file top level) are
  legitimate for expensive one-time loads, but they are shared by **every
  instance of your node type in the process**. The cache key must include
  everything that varies per instance/config, or two differently configured
  nodes silently read each other's data.

## 8. The `RED.util` toolkit

| Helper | Use it for |
|---|---|
| `cloneMessage(msg)` | The only correct deep-clone of a message (handles the message's internal properties correctly) |
| `evaluateNodeProperty(value, type, node, msg, cb)` | Resolving a TypedInput field (`msg`/`flow`/`global`/`str`/`num`/`env`/JSONata) at runtime — the standard way to support "value or expression" config |
| `getMessageProperty(msg, 'payload.a.b')` / `setMessageProperty(...)` | Dotted-path access matching what users type in TypedInput fields |
| `generateId()` | A fresh `_msgid` when synthesizing a brand-new message (an inbound webhook, a poll result) rather than passing on a received one |

`evaluateNodeProperty` with the callback form handles the async context
stores correctly:

```ts
RED.util.evaluateNodeProperty(config.source, config.sourceType, node, msg, (err, value) => {
  if (err) { done(err); return; }
  // use value
});
```

## 9. Config nodes and credentials

Secrets go in the credentials block — the **third argument** to
`registerType` — never in a plain `defaults` field:

```ts
RED.nodes.registerType('yourpkg-server', ServerConfigNode, {
  credentials: {
    apiKey: { type: 'password' },
  },
});
```

Node-RED encrypts credentials at rest and **strips them from flow exports** —
a plain field ends up in every exported flow JSON a customer shares. Read
them at runtime as `node.credentials.apiKey`.

Consumer nodes reference the config node by id:

```ts
const server = RED.nodes.getNode(config.server) as ServerConfigNode | undefined;
if (!server) { done(new Error('No server configured.')); return; }
```

In TypeScript, export an interface for the config node (`extends Node`) so
consumers get typed access instead of `any`.

The `node-config-input-*` id prefix rule is in the SKILL.md silent-failures
list; the test-connection endpoint pattern is in `editor-patterns.md` §8.

## 10. Logging

- Prefix every log line with the node type — `[yourpkg-transform] message` —
  so operators can grep one node's output out of a shared log.
- `node.warn()` for recoverable, expected conditions worth a debug-sidebar
  entry; `node.error(err, msg)` — the **two-argument** form — for faults, so
  Catch nodes receive the message. One-argument `node.error(err)` only logs;
  Catch nodes never see it.
- Status is not logging: status shows the *current* state at a glance; the
  log records *history*. Follow the status conventions in the companion
  skill.
- If your node maintains an internal state machine (reconnect/backoff logic),
  log every transition. Silent state machines are undebuggable in the field.

---

## Checklist

- [ ] `done()` called exactly once per message on every path
- [ ] Faults use `done(err)`; business outcomes use outputs
- [ ] No mutation of `msg` after `send(msg)`; fan-out uses `cloneMessage`
- [ ] Close releases timers, watchers, listeners (named!), in-flight work, sets — and nothing the node doesn't own
- [ ] Heavy work goes through a queue; queue depth is bounded or surfaced
- [ ] Spawned tools: timeout-kills, `tree-kill`, `error` + `close` both handled
- [ ] Exit-code mapping is a pure function with tests, verified against the live tool
- [ ] Writes other processes may read are `.tmp` + rename
- [ ] Watcher inputs pass a stability check before processing
- [ ] Context holds only JSON-safe values; nothing per-message in flow/global
- [ ] Secrets live in the credentials block, nowhere else
