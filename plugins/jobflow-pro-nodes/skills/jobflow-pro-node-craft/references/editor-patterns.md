# Editor patterns

How to write the editor (`.html`) side of a node: dialog lifecycle,
validation, dynamic UI, i18n in editor JavaScript, and admin endpoints. The
companion **jobflow-pro-nodes** skill covers the basic markup (`.form-row`,
`data-i18n`, theming variables); this file covers what goes wrong once the
dialog does anything dynamic.

---

## 1. One shared `window`

Node-RED concatenates every installed package's editor scripts into a single
page. Anything declared at `<script>` top level is a global; two packages
defining the same-named helper collide, and load order decides which wins —
your dialog silently runs someone else's code.

- **Wrap every editor script in an IIFE.** `registerType` and its callbacks
  close over your helpers; nothing leaks:

```html
<script type="text/javascript">
(function () {
  function browse(inputId) { /* private */ }
  RED.nodes.registerType('yourpkg-node', {
    // ... oneditprepare can call browse()
  });
})();
</script>
```

- If several of your nodes share helper code, expose exactly **one**
  namespaced global with an `init(config)` entry point
  (`window.YourPkgBrowse = {...}`) instead of copy-pasting bare functions
  into each file.
- Long unique prefixes (`yourpkgOpenDialog`) are the minimum bar, not the
  safe bar.

## 2. Dialog lifecycle: `oneditprepare` / `oneditsave` / `oneditcancel`

### The initialization guard

Saved values are already in the form when `oneditprepare` runs — but right
after it returns, Node-RED fires a synthetic `change` event once on **every**
field, before showing the dialog. A change handler that clears dependent
fields will therefore wipe the user's saved values every time the dialog
opens. Guard it:

```js
oneditprepare: function () {
  var isInitializing = true;

  $('#node-input-mode').on('change', function () {
    updateVisibleRows();                 // always safe
    if (!isInitializing) {
      $('#node-input-target').val('');   // destructive: user-driven changes only
    }
  });

  updateVisibleRows();
  setTimeout(function () { isInitializing = false; }, 300);
}
```

### Undo what prepare did — on cancel AND save

Everything `oneditprepare` starts must be stopped in **both**
`oneditcancel` and `oneditsave`: intervals (a status-refresh poll), delegated
event handlers bound to `window` or `#dialog-form`, injected DOM. The dialog
is reopened many times per session; anything not undone stacks.

```js
oneditcancel: function () { clearInterval(this._refreshTimer); },
oneditsave:   function () { clearInterval(this._refreshTimer); /* + read UI into this.* */ }
```

### Tell the editor when you changed something

Node-RED marks the workspace dirty when native form fields change. If you
mutate node state programmatically — from a custom widget, a drag
reorder, an ajax result — call `RED.nodes.dirty(true)` yourself, or the user
gets no deploy prompt and loses the edit.

## 3. `defaults`, validators, labels

- **Cross-field validation:** a `validate` function can make a field
  conditionally required — but while the dialog is open, `this` holds the
  values from *before* the dialog opened, not what the user is typing now.
  Read the sibling field's live DOM value first, falling back to `this` for
  validation runs outside the dialog (import, deploy):

```js
defaults: {
  destination: { value: 'local' },
  targetPath:  { value: '', validate: function (v) {
    var dest = $('#node-input-destination').length
      ? $('#node-input-destination').val()
      : this.destination;
    return dest !== 'local' || !!v;
  }},
}
```

- Use the built-ins where they fit: `RED.validators.number()`,
  `RED.validators.typedInput('sourceType')`.
- **Schema evolution:** when a later release adds a property, instances
  created before it have `undefined` there. A strict validator marks every
  existing instance invalid and blocks deploys for users who never opened
  your node. Always accept `undefined` for properties added after first
  release.
- `label` should degrade gracefully: `return this.name || this.host ||
  'sensible default';`. Return Node-RED's `"node_label_italic"` from
  `labelStyle` when no custom name is set — that is what the core nodes do.
- `icon` may be a **function**, so the canvas icon can reflect configuration
  (pick per mode / per referenced config node). Ship custom icons in an
  `icons/` directory beside the node; reference built-ins as
  `'font-awesome/fa-tag'`.

## 4. TypedInput fields

Give users "literal value or expression" fields with the standard widget
instead of inventing syntax:

```js
// defaults
source:     { value: 'payload' },
sourceType: { value: 'msg' },

// oneditprepare
$('#node-input-source').typedInput({
  default: 'msg',
  types: ['msg', 'flow', 'global', 'str', 'num', 'env'],
  typeField: $('#node-input-sourceType'),
});
```

The runtime half is `RED.util.evaluateNodeProperty` — see
`runtime-patterns.md` §8. The two halves must agree on the stored
`type`/`value` pair.

## 5. Dynamic outputs with `editableList`

The number of outputs can follow configuration (one output per rule). The
mechanism: a hidden `outputs` input, an `editableList`, and `oneditsave`
setting `this.outputs`:

```html
<input type="hidden" id="node-input-outputs" />
<ol id="node-input-rule-container"></ol>
```

```js
defaults: { rules: { value: [] }, outputs: { value: 1 } },

oneditprepare: function () {
  $('#node-input-rule-container').editableList({
    addItem: function (row, index, rule) { /* build row UI, translate it yourself */ },
    removable: true, sortable: true,
  });
  (this.rules || []).forEach(r => $('#node-input-rule-container').editableList('addItem', r));
},

oneditsave: function () {
  var rules = [];
  $('#node-input-rule-container').editableList('items').each(function () {
    rules.push(/* read row UI */);
  });
  this.rules = rules;
  this.outputs = rules.length || 1;     // canvas redraws with the right port count
},

outputLabels: function (i) {
  return (this.rules && this.rules[i] && this.rules[i].name) || ('output ' + (i + 1));
}
```

Rows the user adds after the dialog opens miss the automatic i18n pass (it
runs once, right after `oneditprepare`) — build row strings with `this._()`
yourself so initial and user-added rows behave identically (§7).

## 6. Reading the flow graph from the dialog

The editor holds the full **in-memory** flow graph — including undeployed
changes. `RED.nodes.eachLink`, `RED.nodes.node(id)`, and `RED.nodes.eachNode`
let a dialog inspect it: walk downstream wires to auto-discover what your
node is connected to and pre-populate configuration from it, with no admin
round-trip and no deploy needed. Users notice when a dialog already knows
what it is wired to.

```js
function downstreamOf(nodeId, acc) {
  RED.nodes.eachLink(function (link) {
    if (link.source.id === nodeId && !acc.has(link.target.id)) {
      acc.add(link.target.id);
      downstreamOf(link.target.id, acc);
    }
  });
  return acc;
}
```

## 7. i18n in editor JavaScript

`data-i18n` attributes cover the static template only. Everything else is on
you, and the failure mode is always the same: the raw key (or nothing)
renders, with no error.

| Situation | What resolves |
|---|---|
| Inside `oneditprepare`, `label`, validators — anything called bound to the node | `this._('yourpkg-node.label.name')` |
| Async callbacks (`$.ajax`, `setTimeout`, `.then()`), shared helpers, IIFE top level | `RED._('your-package/yourpkg-node:yourpkg-node.label.name')` — fully qualified `module/file:key` |
| DOM added after the dialog is open (user-added `editableList` rows, ajax-built UI) | Missed by the automatic pass, which runs once right after `oneditprepare` — set text yourself using one of the above |

- **Interpolation uses `__var__`, the same as the runtime** — not i18next's
  default `{{var}}`: `"desc": "Rotates through __count__ printers"` +
  `RED._('...desc', { count: n })`. A `{{count}}` placeholder renders
  literally, with no error.
- Fallback technique when binding is uncertain: render the string in the
  template as a hidden span (`<span data-i18n="key" style="display:none">`)
  and read `.text()` from it in JS — the normal i18n pass has already
  translated it.

## 8. Admin endpoints

For editor features that need server-side help (probe a host, list a
directory), register a route in the runtime and call it from the dialog.

Runtime:

```ts
RED.httpAdmin.get(
  '/yourpkg/probe',                                  // package-unique prefix
  RED.auth.needsPermission('yourpkg-probe.read'),    // NEVER omit
  async (req, res) => { res.json(await probe(String(req.query.host))); }
);
```

Editor:

```js
$.getJSON('yourpkg/probe', { host: host })           // RELATIVE URL — no leading slash
  .done(function (data) { /* ... */ })
  .fail(function (xhr) { /* show a real message */ });
```

- **Every route needs `needsPermission`.** Node-RED applies no
  authentication to your routes by itself; an ungated route is an open
  endpoint on the customer's server. Use `<name>.read` for GETs and
  `<name>.write` for mutations.
- **Relative URLs through jQuery only.** The editor's ajax prefilter injects
  the auth token; a leading-slash URL, raw `XMLHttpRequest`, or `fetch()`
  ships without it and 401s — but only on installs with admin security
  enabled, so you will not see it in casual testing. (jQuery's `xhr:` option
  covers advanced cases like upload progress without leaving `$.ajax`.)
- **Per-node-id routes (`/yourpkg/:id/test`) can only find deployed nodes.**
  `RED.nodes.getNode(id)` returns nothing for a node that exists only in the
  editor. Handle it as UX, not as an error: "Deploy first, then test."
- Static assets are simpler than routes: anything in your package's
  `resources/` directory is served automatically at
  `resources/<package-name>/<file>` — vendored JS/CSS, images — with no code.
  (Same rule: reference it with a relative URL.)

## 9. Progressive disclosure

The shape that works in practice is **mode-keyed row visibility**: a
`<select>` for the mode, and one function that shows/hides `.form-row`
groups, called once in `oneditprepare` and on every change:

```js
function updateVisibleRows() {
  var mode = $('#node-input-mode').val();
  $('#row-group-local').toggle(mode === 'local');
  $('#row-group-remote').toggle(mode === 'remote');
}
```

Pair it with the initialization guard from §2 when changes also clear
fields. For genuinely large dialogs, `RED.tabs.create` is the standard
heavy-duty mechanism — the core Function node's dialog is the reference.
Keep `.form-tips` for the one hint the operator needs; move everything else
into the help panel.

## 10. Odds and ends that bite

- **Nested jQuery UI dialogs stack wrong.** A dialog opened from inside an
  already-open dialog can render *behind* it. Bump both the new dialog and
  the overlay: `.closest('.ui-dialog').css('z-index', N)` and
  `$('.ui-widget-overlay').last().css('z-index', N - 50)`.
- **Custom jQuery `.dialog()`s live outside the editor's DOM subtree**, so
  theme CSS (including the CSS custom properties) may not cascade into them.
  Style them explicitly, and test against the dark theme.
- **One palette category per package**, so your nodes group together; config
  nodes go in `'config'`. Keep one node color across the package (the
  companion skill's brand guidance).

---

## Checklist

- [ ] Whole editor script IIFE-wrapped; shared helpers behind one namespaced global
- [ ] Change handlers guarded with an initialization flag; destructive actions user-driven only
- [ ] `oneditcancel` and `oneditsave` both stop timers/handlers/DOM started by prepare
- [ ] `RED.nodes.dirty(true)` after every programmatic state change
- [ ] Validators tolerate `undefined` for post-release properties
- [ ] Dynamic outputs set `this.outputs` in `oneditsave`; `outputLabels` explains each port
- [ ] `editableList` rows translated at creation time
- [ ] Admin routes: package-unique prefix + `needsPermission` on every one
- [ ] Editor calls: relative URLs via `$.ajax`/`$.getJSON` only
- [ ] Per-node-id endpoints show "deploy first" UX instead of a raw error
- [ ] Custom dialogs tested in dark theme; nested dialogs z-index-bumped
