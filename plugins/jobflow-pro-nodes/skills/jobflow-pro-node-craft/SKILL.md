---
name: jobflow-pro-node-craft
description: Node-RED development craft for Fiery JobFlow Pro — hard-won best practices for node runtime code, editor UI, internationalisation, and function-node JavaScript. Use when writing or reviewing a Node-RED node or function-node code that runs inside JobFlow Pro, or when debugging editor dialogs, i18n, message mutation, or flow behavior.
---

# Node-RED craft for JobFlow Pro

The companion skill, **jobflow-pro-nodes**, covers the JobFlow Pro integration
contract: job tracking, the step shape, the file-path message contract, status
colors, and the basic editor markup. Read it first — nothing here repeats it.

This skill covers the craft *underneath* that contract: how to write Node-RED
runtime code, editor dialogs, and function-node JavaScript that keep working
under production load. It is distilled from years of building and debugging
nodes on the platform JobFlow Pro is built on. Everything in it is standard
Node-RED behavior — verified against Node-RED 4.0.9, the version JobFlow Pro
embeds — so it applies to plain Node-RED too.

## When to Use

- Writing or reviewing the runtime (`.js`/`.ts`) side of a node
- Writing or reviewing an editor template (`.html`) — dialogs, validation, i18n
- Writing JavaScript inside a Function node in a JobFlow Pro flow
- Debugging: strings render literally, dialogs misbehave, messages corrupt
  each other, flows leak timers or processes across redeploys

## How this skill is organised

The traps below fail **silently** — nothing errors; the behavior is just wrong.
Read them now. The three reference files go deeper; load them when the task
calls for it:

| When you are... | Read |
|---|---|
| Writing runtime code: input handlers, cleanup, spawning tools, files, context | `references/runtime-patterns.md` |
| Writing editor UI: dialogs, validators, dynamic outputs, admin endpoints, editor i18n | `references/editor-patterns.md` |
| Writing JavaScript inside a Function node | `references/function-node-js.md` |

---

## The silent failures

### 1. The first delivery of every `send()` is your object, by reference

The runtime's cloning is real but partial, and the gaps are silent. Within a
**single** `send()` call (or Function-node `return`), the first populated
slot is delivered by reference and every later delivery is deep-cloned. That
guarantee is per-call: fan out with **separate** `send()` calls — the loop
pattern — and nothing is cloned; every call's message goes out by reference,
and two of them sharing a nested object stay entangled wires apart. And the
first delivered message always aliases the object you still hold: mutate it
after `send()` and you mutate what the downstream node is processing. (A
Function node's `node.send()` clones its first message precisely to protect
you from that; `return` does not.)

Rule: **never rely on the runtime to make copies.** When you fan out with
repeated sends, or keep using a message after sending it, clone explicitly:

```js
const copy = RED.util.cloneMessage(msg);
```

### 2. i18n interpolation is `__var__` — never i18next's default `{{var}}`

Node-RED configures i18next with `__`-delimited interpolation on **both**
sides, editor and runtime. `RED._(key, { port: 8080 })` substitutes
`__port__` in the locale string. A `{{port}}` placeholder — the syntax every
i18next tutorial shows — is not interpolated anywhere in Node-RED and
renders literally in the UI, with no warning.

```json
{ "status": { "listening": "Listening on :__port__" } }
```
```ts
node.status({ text: RED._('yourpkg-node.status.listening', { port }) });
```

### 3. Every node's editor script shares one `window`

Node-RED loads the `<script>` blocks of *every installed package* into a
single page. A bare top-level `function checkPath() {}` becomes
`window.checkPath` — and if any other installed node also defines
`checkPath`, **load order decides which one wins**. Your dialog then silently
calls someone else's helper (or theirs calls yours). Wrap the whole script in
an IIFE:

```html
<script type="text/javascript">
(function () {
  function checkPath() { /* private to this file */ }
  RED.nodes.registerType('yourpkg-node', { /* closes over checkPath */ });
})();
</script>
```

Unique name prefixes are the minimum bar; the IIFE is the safe bar.

### 4. `RED._('key')` silently fails outside the node's own context

Inside functions Node-RED calls bound to your node (`oneditprepare`, `label`,
validators), `this._('yourpkg-node.label.name')` resolves against your
catalog. But in an **async callback** — `$.ajax` handlers, `setTimeout`,
`.then()` — or any shared helper, `this` is rebound and a bare key does not
resolve. Fully qualify it with your module and file:

```js
RED._('your-package-name/yourpkg-node:yourpkg-node.status.offline')
```

### 5. One `node.done()` call disables auto-completion everywhere (Function nodes)

If your Function node code never mentions `node.done()`, the runtime calls it
for you when your code finishes. The moment a real `node.done()` call appears
*anywhere* in the code, auto-completion is disabled for **every** path — and
any branch that forgets to call it leaves the message permanently incomplete:
no error, just broken flow-completion tracking. Either never call it (and
`await` all your async work), or call it on every path including errors.

### 6. DOM created after the dialog is open is never auto-translated

Node-RED runs its `data-i18n` translation pass **once per dialog open**, just
after `oneditprepare` returns. Anything added later — an `editableList` row
from the user clicking *add*, elements built in an ajax callback — keeps its
raw keys or empty text. Translate such content yourself as you build it, with
`this._()` or a fully-qualified `RED._()`.

### 7. Adding a field to a shipped node breaks old instances unless the validator tolerates `undefined`

Node instances created before your new `defaults` property existed have it as
`undefined`. A strict validator (`RED.validators.number()`, `v => v.length >
0`) marks every already-deployed instance invalid — red triangles across
customer flows, deploy blocked — for users who never touched your node. Treat
`undefined` as valid when evolving the schema:

```js
threshold: { value: 10, validate: v => v === undefined || RED.validators.number()(v) }
```

### 8. Every `RED.httpAdmin` route is unauthenticated until you gate it

Node-RED does not apply admin authentication to your routes for you. A route
registered without `RED.auth.needsPermission(...)` is an open, unauthenticated
endpoint on the customer's server:

```ts
RED.httpAdmin.get('/yourpkg/probe', RED.auth.needsPermission('yourpkg.read'), handler);
```

And on the editor side, call it with a **relative URL** (no leading slash)
through `$.ajax`/`$.getJSON` — jQuery's prefilter injects the auth token;
absolute paths and hand-rolled `XMLHttpRequest`/`fetch` bypass it and fail
with 401 on secured installs only, which is exactly where you cannot debug.

### 9. Config-node dialogs use `node-config-input-*` ids

A config node's edit template must use `node-config-input-<field>` ids, not
the `node-input-<field>` ids regular nodes use. Get it wrong and nothing
errors — the fields simply never bind, and every save silently discards what
the user typed.

### 10. Never build a fresh `msg` object

`return { payload: result }` destroys every other property on the message —
`msg.jobflow`, `msg.filepath`, `msg._msgid`, everything upstream nodes
attached. In JobFlow Pro that severs the message from its job. Mutate the
message you received and pass **it** on:

```js
msg.payload = result;
return msg;
```

---

## Craft checklist

Beyond the conformance checklist in **jobflow-pro-nodes**:

- [ ] Editor script is IIFE-wrapped; nothing leaks onto `window`
- [ ] Repeated-send fan-outs clone with `RED.util.cloneMessage`; nothing mutates `msg` after `send()`
- [ ] Locale placeholders use `__var__` — no `{{var}}` anywhere
- [ ] `RED._()` calls in async callbacks use fully-qualified `module/file:key` form
- [ ] Dynamically created DOM is translated at creation time
- [ ] Validators on fields added after first release tolerate `undefined`
- [ ] Every `httpAdmin` route has `needsPermission`; editor calls use relative URLs
- [ ] `close` handler releases everything the node created — and nothing it didn't
- [ ] Function-node code either never mentions `node.done()` or calls it on every path
- [ ] No code path constructs a replacement `msg` object
