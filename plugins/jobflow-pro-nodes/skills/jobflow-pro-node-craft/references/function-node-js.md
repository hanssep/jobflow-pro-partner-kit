# JavaScript in Function nodes

What actually runs when you type code into a Function node, and the patterns
that keep it correct. Verified against the Function node runtime in Node-RED
4.0.9, the version JobFlow Pro embeds.

---

## 1. What your code really is

The Function node wraps your "On Message" code in an **async function** and
runs it inside a V8 sandbox (`vm.createContext`) — a real context boundary,
not just a helper object. Two consequences up front:

- **`await` works at the top level of your code.** The wrapper is async.
- **Only what Node-RED put in the sandbox exists.** This is not your Node.js
  process's global scope.

### In scope

| Name | What it is |
|---|---|
| `msg` | The message. Mutate it; don't replace it. |
| `node` | `id`, `name`, `path`, `outputCount`, `log/warn/error/debug/trace`, `status`, `send`, `done`, `on` (but `node.on('input', ...)` throws — the runtime owns input) |
| `context` / `flow` / `global` | The three context stores (§7) |
| `env.get('NAME')` | Environment/flow/group variables and subflow properties |
| `RED.util` | The utility toolkit — `RED.util.cloneMessage` matters most here |
| `console`, `util`, `Buffer`, `Date`, `promisify` | Standard helpers |
| `setTimeout` / `setInterval` (+ clears) | **Wrapped**: every timer is tracked and auto-cleared when the node stops or redeploys, and callback errors are routed to `node.error`. Safe to use. |
| JavaScript built-ins | `JSON`, `Math`, `Promise`, `RegExp`, ... — the language itself |

### Not in scope

`require`, `process`, `fs`, `fetch`, `module`, `__dirname` — none of these
exist. In particular:

```js
const fs = require('fs');   // ReferenceError: require is not defined
```

JobFlow Pro ships the stock configuration: no modules are pre-injected, and
the **Setup tab** is the supported way to get one (§2).

## 2. Modules: the Setup tab

Open the node's **Setup** tab and add the module with a variable name. It
appears in your code as that variable — npm packages and built-in Node
modules both work:

| Module | Variable | In your code |
|---|---|---|
| `os` | `os` | `os.hostname()` |
| `uuid` | `uuid` | `uuid.v4()` |

Details that matter:

- The variable name may not collide with anything already in the sandbox
  (and never `node`) — the node errors at deploy if it does.
- Modules load asynchronously at deploy. Messages arriving before loading
  finishes are **queued and replayed** — you will not see a message while
  your modules are half-loaded.
- If the module cannot be installed/loaded, the node errors and processes
  nothing — watch the debug sidebar after adding one.

## 3. Sending messages: `return` vs `node.send()`

| You write | What happens |
|---|---|
| `return msg;` | One message out the first output |
| `return null;` | Nothing sent — the message stops here |
| `return [msgA, msgB];` | One message per output (2 outputs) |
| `return [null, msgB];` | Skip output 1, send on output 2 |
| `return [[m1, m2], msgB];` | **Array per output**: two messages out output 1, one out output 2 |
| `node.send(...)` | Same shapes, any time — including several calls per input message |

Use `return` when one input produces one round of output. Use `node.send()`
when output happens over time or repeatedly — then completion is on you
(§5).

## 4. Cloning: what is copied, and what is not

Verified behavior, two layers deep:

- **The Function node itself**: `return` clones nothing; `node.send()`
  clones only the first non-null message of the call — a guard so you can
  keep mutating `msg` after sending it. `node.send(msgs, false)` disables
  that guard.
- **The runtime underneath** then delivers the first message of each call by
  reference and deep-clones every later delivery within that call.

Net effect: within one `return`/`node.send()`, later copies are made for
you — but each **separate** `node.send()` call delivers by reference, so the
streaming pattern (several sends per input) entangles messages that share a
nested object. When fanning out over time, clone everything you duplicate:

```js
const out = [];
for (const item of msg.payload) {
  const m = RED.util.cloneMessage(msg);
  m.payload = item;
  out.push(m);
}
return [out];          // array-per-output: all of them out output 1
```

And never rebuild the message — `return { payload: x }` destroys
`msg.jobflow`, `msg.filepath`, and everything else upstream nodes attached.
Set properties on the `msg` you received.

## 5. Completion: the `node.done()` trap

Node-RED tracks when each node finishes with a message (Complete nodes,
flow debugging, and JobFlow Pro's own bookkeeping rely on it).

- If your code **never mentions** `node.done()`, the runtime completes the
  message automatically when your (async) code finishes. Because the wrapper
  is async, **top-level `await` + `return` needs no `node.done()` at all** —
  this is the simplest correct pattern:

```js
const data = await lookup(msg.payload);   // top-level await is fine
msg.payload = data;
return msg;
```

- The runtime detects `node.done()` by **parsing your code**. One real call
  anywhere switches off auto-completion for the *entire* function — every
  path, including every error path, must now call it, or the message never
  completes. No error is raised; completion tracking just silently breaks.

You only need `node.done()` when work escapes the async wrapper — an
un-awaited callback:

```js
legacyApi.fetch(msg.topic, function (err, data) {
  if (err) { node.error(err, msg); node.done(); return; }
  msg.payload = data;
  node.send(msg);
  node.done();
});
return;   // nothing returned now; BOTH callback paths call node.done()
```

If you can `await` it instead, do — and drop `node.done()` entirely.

## 6. Errors

- **`throw`** (or a rejected top-level `await`): the runtime attaches the
  error to the message and fails it — Catch nodes on the tab receive it,
  with your function's line number in the message.
- **`node.error(text, msg)`** — the two-argument form — reports a catchable
  error *without* aborting your code. The one-argument form only writes to
  the log; Catch nodes never see it. Always pass `msg`.
- Business outcomes (a file that fails validation) are not errors: route
  them out a second output and keep `node.error` for genuine faults — the
  same rule the companion skill sets for custom nodes.

## 7. Context, env, status

```js
// per-node                     // per-tab                  // process-wide
context.get('n');               flow.get('n');              global.get('n');
context.set('n', v);            flow.set('n', v);           global.set('n', v);
```

- Same rules as everywhere: JSON-safe values only (persistent context stores
  serialize), nothing per-message in `flow`/`global`, paths instead of
  payloads. See `runtime-patterns.md` §7.
- Multiple values in one call beat two round trips:
  `const [a, b] = context.get(['a', 'b'])`.
- `env.get('NAME')` reads environment variables, flow/group variables, and
  subflow instance properties — prefer it over hardcoding paths or hosts.
- `node.status({ fill: 'blue', shape: 'dot', text: '...' })` works from
  function code and follows the same color conventions as custom nodes. The
  runtime clears it automatically when the node stops (only if you ever set
  one).

## 8. On Start and On Stop

- **On Start** runs at deploy, before any message; it may be async —
  messages queue until it resolves. Use it to initialize context.
- **On Stop** runs at redeploy/shutdown for cleanup. **It cannot send
  messages** — calling `node.send` there logs `Cannot send from close
  function` and does nothing; the rest of your On Stop code keeps running.
- Timers you started with `setTimeout`/`setInterval` are cleaned up for you;
  On Stop is for everything else you created (context state, connections a
  Setup-tab module opened).

## 9. Timeout

The node's **timeout** setting (Setup tab, seconds) is a V8-level timeout on
**synchronous** execution — it can interrupt a busy loop, which no
application-level check can. It does **not** abort a hung `await`: your code
runs as an async function, and the V8 timeout stops applying the moment
execution first yields. JobFlow Pro's default is `0` (no timeout).

So the setting does not protect a call to an external service. Bound that
yourself — race the call against a timer:

```js
const result = await Promise.race([
  callService(msg.payload),
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Service timed out')), 10000)),
]);
```

(The wrapped `setTimeout` is auto-cleared if the node stops first.)

## 10. When to stop writing Function nodes

A Function node is the right tool for glue: reshape a payload, branch on a
condition, compute a value. Graduate to a **custom node** (the rest of this
skill plus the companion skill) when any of these appear:

- The same code is pasted into a second flow
- It needs configuration a user should edit in a dialog — especially
  credentials, which Function nodes cannot store encrypted
- It needs translated UI, help text, or a palette identity
- It spawns processes or manages connections whose lifecycle must survive
  scrutiny (close handling, §3 of `runtime-patterns.md`)
- You want to ship it to other JobFlow Pro installs as a package

---

## Anti-patterns

| Do not | Why | Instead |
|---|---|---|
| `require('anything')` | Doesn't exist in the sandbox; throws | Setup tab module list |
| `return { payload: x }` | Destroys `msg.jobflow` and everything else on the message | `msg.payload = x; return msg;` |
| Call `node.done()` on the happy path only | One call disables auto-completion for every path | No `node.done()` at all (await + return), or every path |
| Fire an async operation and neither `await` nor complete it | Message completion breaks silently | `await` it, or callback + `node.done()` on all paths |
| `node.error(text)` one-arg for real failures | Invisible to Catch nodes | `node.error(text, msg)` |
| Reuse a message you already sent — mutate it after `send`, or send it again in a later call | The first delivery of every call is by reference; downstream sees your edits | `RED.util.cloneMessage` before reuse |
| Store a `Map`/class/Buffer in context | Dies on persistent-store serialization | JSON-safe values; paths not payloads |
| 200-line do-everything function | Untestable, undebuggable | Split across nodes, or write a custom node |
