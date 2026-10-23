# Widget plugins: guest contract

Status: proposal, 2026-10-09.

Files: [README](README.md) · [DESIGN](DESIGN.md) · **GUEST-CONTRACT** · [WIDGETS-JSON](WIDGETS-JSON.md) · [SERVER-SIDE](SERVER-SIDE.md) · [SECURITY](SECURITY.md) · [PLAN](PLAN.md) · [SPIKE](SPIKE.md) · [AUTHORING](AUTHORING.md)

This is what a plugin's code is written against: the Anywidget front-end module (AFM) contract, the model the host provides, the commands it can call and the exports the host calls. Everything here runs inside the sandboxed frame. The host side (registry, authority, admin) is in DESIGN; the server-side calls it can make are in SERVER-SIDE; the sandbox is in SECURITY.

The host API is small and explicit on purpose: a handful of permissions, a handful of commands, two exports, and the model. It is versioned (`host.api` is a major, `host.afm` the module revision), and anything not listed here does not exist for a plugin.

## 1. What is adopted and what is not

A plugin's `entry.js` is an **AFM**: an ES module whose default export is `{ initialize, render }`, or a factory that returns it, written against the [AFM specification](https://anywidget.dev/en/afm/) as of anywidget 0.11. The Workspace implements the host side of AFM in the shell.

Adopted: the module shape, the `model` interface, `signal`-based lifecycle, change events, custom messages with buffers, `experimental.invoke`, and exports returned from `initialize`.

Not adopted: the Python package, traitlets and the Jupyter comm protocol. There is no kernel. State comes from host bindings and "kernel commands" become host commands.

Reasons: the spec is small and host-agnostic; authors already have typings (`@anywidget/types`) and tooling; modules written for other hosts can be re-packaged; and it already defines what this design needs, namely an initialize/render lifecycle with cleanup, reactive state, binary messages and request/response commands. Anywidget's own loader evaluates `_esm` text with `URL.createObjectURL(new Blob([...]))` and `import()`, the technique the shell uses with bundle bytes the host delivers.

| AFM | Here |
|---|---|
| Default export `{ initialize?, render? }`, or an async factory returning it | Same. Only the default export is supported. |
| `initialize({ model, signal, experimental })`, awaited before `render` | Runs once per frame. Returns nothing, a cleanup function, or an exports object (section 5). |
| `render({ model, el, signal, host, experimental })` | Runs once per frame. `el` is a full-size element in the frame. |
| `model.get`, `set`, `save_changes`, `on`, `off`, `send` | Implemented by the shell over the bridge. Traits come from manifest bindings (section 3). |
| `change:<trait>` events | Fired on host pushes and on local `set`. |
| `msg:custom` events with buffers | Host events (section 3.4). |
| `experimental.invoke(name, msg, { buffers, signal })` returns `Promise<[value, DataView[]]>` | Host commands, permission-checked (section 4). |
| `host.getWidget`, `host.getModel`, `model.widget_manager` | Disabled. They reject with `not_available`. No cross-widget access. |
| `_esm`, `_css` | `entry.js`, `entry.css` from the package. CSS is injected as `<style>`; the URL form is not supported. |
| Modules run in the host page | Modules run in a sandboxed frame without storage and, by default, without network. |

The shell implements AFM 0.11, the manifest names it (`host.afm`), and a conformance suite (section 8) fails when the shell's behavior drifts from the specification.

### 1.1 Against the existing iframe protocol

The `iframe` widget type already has a protocol of its own (`frontend/src/types/iframeProtocol.ts`, `components/Widgets/Helpers/useIframeProtocol.tsx`). It does a different job. It lets a web app that lives at a URL, with its own origin, server and storage, take part in a dashboard. AFM is how code that the Workspace itself loads, verifies and runs is written. The two stay separate: a plugin does not speak the iframe protocol, and the `iframe` type does not become AFM.

| iframe protocol | AFM contract |
|---|---|
| `workspace-connect`: the page declares its sub-widgets and its param controls when it starts | The manifest declares widgets, params and permissions before anything runs, and the admin reviews them. One frame is one widget. |
| `workspace-params-update`: all params as one flat map of strings, `theme` among them. Once a page has connected, this message is how it learns of a change: the iframe's address does not change, so the page is not reloaded, and applies the change with its own code | `params` and `param:<name>` traits with their types, and `change:` events. `theme` is its own trait. |
| `workspace:params:update`, `workspace:widget-params:update`: the page sets params | `set` and `save_changes()` with `core:params:write`, for declared names only. The host echoes what it accepted. |
| `workspace-request`, `workspace-data`, `workspace-error`: the host asks a sub-widget for rows or markdown | `exportOptions()`, `exportData(id, context)` and `copilotContext()`, called by the host, with `core:export:provide` and `core:copilot:context`, size-capped. |
| `aiData`: the page pushes text into the agent's context | None. The host pulls `copilotContext()`. A plugin cannot push into the agent. |
| `workspace-auth`: the host sends the page the backend's credential headers, and the user's SSO ID-token headers when the deployment enables them | None, by design. Credentials never reach the frame (section 4). |
| The page fetches its own data from its own server. The host adds the params to the URL's query | The host fetches the widget's data and pushes it into `data`. The frame has no network by default. |
| No lifecycle: loading the URL is starting, and a refresh reloads it | `initialize`, `render`, `dispose`, `signal`, and commands with `invoke`. |

What the table does not show. The iframe protocol trusts whatever page is at the URL: there are no permissions and no version, and the code is whatever the remote server sends on each load. It recognizes a sender by its window: the widget's own iframe or a frame nested in it, so each instance of an iframe widget hears only itself, and two copies of one page, or two pages of one origin, cannot answer for each other. It runs only when `allowHtmlJsExecution` is on, in a sandbox of `allow-scripts allow-same-origin` that holds only while the page's origin differs from the Workspace's. AFM runs code the host delivers and verifies, in an opaque-origin frame, over a private port, with permissions checked at every call. Nothing of the iframe protocol is reused (SECURITY 9).

## 2. Module shape and lifecycle

Per frame, in order:

1. The shell boots, runs its canary and completes the handshake (SECURITY 5). If any check fails no plugin byte is sent.
2. The host sends the verified bundle (entry bytes and styles) and the **initial model state**. Every bound trait is present before `initialize` runs, so `model.get` works there. Files under `assets/` are not sent: the module asks for each one it needs with `core:asset:read` (section 4), so a frame that needs none, or needs one only later, does not pay for them.
3. The shell evaluates the module through a Blob URL, then resolves `default`: an object, or `await default()` for the factory form.
4. `await initialize({ model, signal, experimental })`. If it throws or rejects, the phase failed: `render` is not called, the signal is aborted and the host shows the error state with the reported message. A failed `initialize` stays failed.
5. `await render({ model, el, signal, host, experimental })`.
6. Running: host pushes fire `change:` events; the module writes with `set` and `save_changes`, calls commands with `invoke`; the host calls the exports.
7. Dispose: the host sends `dispose`; the shell aborts the signals, runs returned cleanup callbacks (per the spec the callback and the signal are one cleanup channel, not two), empties `el` and closes the port. The host removes the iframe.

Timeouts (proposed, configurable): `initialize` and `render` 15 s each, because bundle parsing is heavy; `invoke` 10 s by default (anywidget's own default is 3 s), overridable with a `signal`.

**One frame is one view.** The spec lets several views share a model and its `initialize` state. Here every frame, including a widget's fullscreen view, runs its own `initialize`. A module must not rely on state shared between views.

Uncaught errors and unhandled rejections inside the frame are caught by the shell, counted and reported. They do not stop the shell. Repeated violations of the budgets in SECURITY 3 end the frame.

## 3. The model

### 3.1 Traits and bindings

A trait is a named value on the model. The manifest's `model.traits` binds a trait name to a piece of host state. This replaces what a Python class declares with traitlets, and lets an unmodified AFM module keep its own trait names.

```jsonc
"model": {
  "traits": {
    "rows":   { "bind": "data" },
    "filter": { "bind": "param:filter", "access": "readwrite" },
    "colors": { "bind": "theme" }
  }
}
```

| `bind` | Host state | Writable |
|---|---|---|
| `data` | The widget's fetched data (JSON, after `data.dataKey`), or its rows while the user shows them (WIDGETS-JSON 4.11). Present only with `core:data:read`. | no |
| `params` | All declared params as `{ name: value }`. | with `core:params:write`, declared names only |
| `param:<name>` | One declared param. | same |
| `definition` | The widget definition's type-specific configuration: the `data.<type>` object of its `widgets.json` entry, validated by the plugin's `definition` schema (WIDGETS-JSON 3.3). | no |
| `config` and `config:<key>` | The instance settings the user edits. | no |
| `adminSettings` and `adminSettings:<key>` | The plugin's admin settings (non-secret). | no |
| `state` | The instance state persisted with the dashboard, at most 64 KiB of JSON. | with `core:state:write` |
| `theme` | `{ mode, tokens, locale, decimals }`. | no |
| `capabilities` | The effective permissions, as a string array. | no |
| `meta` | `{ pluginId, version, widgetId, instanceId }`. | no |

Without a `model` entry, traits take the names of the sources: `data`, `definition`, `params`, `config`, `adminSettings`, `state`, `theme`, `capabilities`, `meta`. A trait with no binding is **frame-local**: `set` works, `change:` fires, nothing leaves the frame.

### 3.2 Semantics

- **Host push.** A push carries one or more traits. The shell applies all of them, then fires `change:<trait>` for each one that changed. Callbacks get no arguments (spec); read with `get`.
- **Guest write.** `set` updates the local value and fires `change:`. `save_changes()` sends the changed writable traits in one message. The host validates each one (writable binding, permission, scope, size) and **echoes** the accepted value back. A rejected write is echoed with the previous value, so a second `change:` event restores it. Rejections are counted.
- **Values are copies.** `get` returns a structured clone owned by the module. Changing a returned object does not change the model; call `set`.
- **Large data.** `data` crosses the port by structured clone. A binary path (buffers on `msg:custom`, for example Arrow) is a later extension.

### 3.3 Params in practice

`filter` above is a Workspace param. The host renders the param control, takes part in param groups and linking, and refetches when the value changes. The module only reads and writes the trait.

### 3.4 Custom messages

`model.on("msg:custom", (msg, buffers) => ...)` receives host events. v1 defines two, both optional to handle: `{ kind: "workspace-event", name: "refresh" }` and `{ kind: "workspace-event", name: "visibility", visible: boolean }`.

`model.send(content, callbacks, buffers)` is recognized only for the message `invoke` produces (`kind: "anywidget-command"`). Any other content is dropped and counted.

## 4. Commands

`experimental.invoke(name, msg, { buffers, signal })` returns `Promise<[value, DataView[]]>`. In Jupyter it calls a command on the Python side; in the Workspace it calls a **host command**. (Anywidget implements it by sending `{ id, kind: "anywidget-command", name, msg }` as a custom message and waiting for a reply with the same id; the shell does the same over the port.) AFM calls `experimental` provider-specific, so a module that uses it depends on a Workspace host and should check `model.get("capabilities")` first.

| Permission | Allows | Limits |
|---|---|---|
| `core:default` | Lifecycle, error reporting, console logs, and `invoke("core:asset:read", { path })`, which resolves to `{ path, size }` and the file as the one buffer. | Always granted. Only files under the package's `assets/`, checked against the approved version like the module. |
| `core:data:read` | The `data` trait is populated. | `maxBytes` scope, default 32 MiB. More becomes an error state. |
| `core:params:write` | Writes to `params` and `param:<name>`. | Declared names; values coerced to the `ParamDef` type. |
| `core:state:write` | Writes to `state`. | 64 KiB of JSON. |
| `core:copilot:context` | The host may call `copilotContext()`. | Result at most 256 KiB. |
| `core:export:provide` | The card's Export entry calls `exportOptions()` and `exportData(id, { title })` (section 5). | The code decides what it exports; at most 16 options and 25 MiB. |
| `core:ui:notify` | `invoke("core:ui:notify", { level, text })` | Plain text, 500 characters, rate limited, shown with the plugin's name. |
| `core:ui:open-link` | `invoke("core:ui:open-link", { url })` | `https:` and `mailto:` only; goes through the existing external-link confirmation. |
| `core:clipboard:write` | `invoke("core:clipboard:write", { text })` | 1 MiB; needs a user gesture (to verify in the spike). |
| `core:download:save` | `invoke("core:download:save", { filename, mime }, { buffers: [bytes] })` | 25 MiB; filename sanitized; needs a user gesture. |
| `core:proxy:call` | `invoke("core:proxy:call", { id, args })` returns the response body | Only proxies the widget declares; `args` checked against the proxy's declared types; the API makes the call and injects secrets (SERVER-SIDE 3). |
| `core:backend:call` | `invoke("core:backend:call", { route, args })` returns the response body | Only routes the widget declares; limits per route (SERVER-SIDE 5). |
| `core:data:query` (later) | `invoke("core:data:query", { params })` returns rows | The bound endpoint only; paged; rate limited. |

**Credentials never reach the frame.** No command returns a token, a key or a secret, and no trait carries one. A proxy or backend call sends an id and arguments; the API adds the credentials on its side.

**Direct network is not a permission.** What a frame may contact itself is its CSP (SECURITY 4), which the browser enforces and the admin approves. Calls that carry a secret, or that return data the plugin should not expose in the browser's network panel, go through `core:proxy:call` instead.

A refused call rejects with an `Error` whose `name` is one of `not_granted`, `invalid_args`, `out_of_scope`, `rate_limited`, `too_large`, `unknown_command`, `timeout`, `unavailable`. The caller is identified by its port, never by anything in the message, and every call is checked by the runtime authority before a handler runs.

## 5. Exports: what the host calls

`initialize` may return an object instead of a cleanup function; AFM tells the two apart with `typeof`. AFM exposes that object to other widgets. Here the Workspace host reads these members:

```ts
type ExportOption = {
  id: string;         // ^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$, unique in the list
  label: string;      // what the user picks, 1 to 60 characters
  extension: string;  // ^[A-Za-z0-9]{1,10}$: the file is saved as <title>.<extension>
  mime: string;       // the file's type, type/subtype without parameters
};

type WorkspaceExports = {
  // Called each time the user opens Export on the widget's card: what the widget can
  // export now, decided by its code from its own state. [] means nothing to export.
  exportOptions?(): ExportOption[] | Promise<ExportOption[]>;
  // Called with the option the user picked and the name they gave the file. Returns the
  // file's contents: a string (saved as UTF-8), an ArrayBuffer, a typed array or a Blob.
  // null or undefined means nothing to export after all.
  exportData?(id: string, context: { title: string }): unknown | Promise<unknown>;
  copilotContext?(): Promise<unknown>;
};
```

The host assumes no format: what a widget exports, and in what form, is entirely its code's. The card's Export entry is there only when the widget has `core:export:provide` and returns both `exportOptions` and `exportData`; it opens the Workspace's export dialog with the options, and saves what `exportData` returns with the option's extension and type. There is no fallback: the card's picture of its DOM cannot see into the frame.

Each member is called only with the matching permission, and the results are validated and size-capped before use (16 options, 25 MiB of data; `exportOptions` and `copilotContext` have 10 seconds, `exportData` 60). Other members are ignored. When `initialize` returns an exports object, cleanup goes through `signal`, which the spec prefers anyway.

## 6. Disabled or unsupported

| Feature | Behavior |
|---|---|
| `host.getWidget`, `host.getModel`, `model.widget_manager.get_model` | Reject with `not_available`. |
| Named `render` export; `_css` as a URL | Not supported. |
| Remote `import` or `import()` of a URL | Fails unless the effective CSP allows the origin. Bundle instead. |
| `localStorage`, `sessionStorage`, `indexedDB`, `document.cookie` | Throw `SecurityError` (opaque origin). Keep preferences in the `state` trait. |
| `window.open`, `alert`, `confirm`, form submission, navigating the top window | Blocked by the iframe sandbox. |
| `navigator.clipboard`, downloads | Use `core:clipboard:write` and `core:download:save`. |
| Python-side logic, kernel messages | None. A widget that needs a round trip to Python is not portable. A round trip to server-side code is a declared proxy or backend route. |
| Reading or changing another widget's content or state | Not possible: one frame per instance, no shared storage, no cross-widget access. |
| The agent's MCP tools, and the widget's `mcp_tool` link | Not reachable. The link is read by the host and the agent only: no binding carries it and no command or permission calls the tool (WIDGETS-JSON 5.3). |

## 7. Writing a plugin

1. Write an AFM module. Use `@anywidget/types` for types; it carries no runtime code.
2. Bundle to a single file. Inline dynamic imports. No remote imports. A remote origin in `csp.script-src` needs a superuser's approval, and it removes the integrity guarantee for those files (SECURITY 4.4).
3. Do not use storage, popups, alerts or cookies.
4. Handle missing permissions: read `model.get("capabilities")`.
5. Read the `theme` trait and react to `change:theme`.
6. Size yourself with a `ResizeObserver` on `el`; the host sizes the frame.
7. Declare traits in the manifest when you reuse an existing module. Otherwise use the default names.
8. Declare the CSP you need and nothing more. Add a one-line reason per directive in `cspNotes`: the admin reads it when approving.
9. Lay the package out as `<id>/<version>/` with `plugin.json`, `entry.js`, `entry.css` and `assets/`, and run `python -m scripts.plugin_check <dir>` (the server's own validator, offline). The deployer places the directory on the server; there is no upload.
10. Declare what you need, and only that: permissions per widget, `csp`, `secrets`, `dataSources`, `identity`, `server.network`. The admin reads all of it before enabling. Do not ask for a secret you can avoid.

**Porting an existing anywidget.** Take the `_esm` and `_css` files from the Python package. Bundle them. Map their traits in `model.traits`. Replace CDN imports. Replace kernel round trips (a `model.send` message that Python answers) with data from a backend endpoint or a host command. Test in the shell, where the first failures are usually storage access and remote imports.

## 8. Conformance

One suite pins the contract. It is derived from the spec text and runs in Vitest (the shell logic) and Playwright (real frames):

- **Spec cases.** `initialize` completes before `render`; a failing hook does not advance, aborts the signal and surfaces the error; the signal aborts on dispose and cleanup callbacks run once; `change:` fires after host pushes and local `set`; `off` removes listeners; `send` and `msg:custom` carry buffers; `invoke` resolves `[value, buffers]`, times out and honors an abort.
- **Negative cases.** Cross-widget access rejects; unknown messages are dropped; unbound traits never sync; a write without the permission or outside the scope is refused and echoed back; oversized values are refused.
- **Interop smoke tests.** A few public AFM modules, bundled in a scratch directory with pinned versions and run in a frame, nightly. They are fixtures, not plugins, and are not committed.

As built. `frontend/tests/unit/plugins/shell.conformance.test.ts` runs `shell.js` itself in Vitest against a fake window, with the test as the host on the other end of the port; only the bundle's import becomes an import of a `data:` URL, since Vitest's module runner refuses `import()` from code built with `new Function`. It covers every spec case above and the negative cases that are the shell's: cross-widget access, dropped messages, forged violation events, buffers that are not binary. `frontend/tests/e2e/plugin-conformance.spec.ts` runs a plugin in a real frame against the real host: the hook order, a command answered and one refused, anywidget's own `invoke` over `model.send`, a write without the permission and one over the size cap echoed back, cross-widget access, and a refresh arriving as a host event. Writing the suite found three gaps, now closed: `model.send` dropped anywidget's command message (it is now answered as 3.4 says), the card's refresh never reached the frame (it now arrives as the `refresh` event), and a second dispose ran the cleanups again. The Playwright specs run in Chromium, Firefox and WebKit.

The interop smoke tests are `frontend/tests/e2e/plugin-interop.spec.ts`, run nightly in the three engines by `.github/workflows/plugin-interop.yml` (and by hand with `E2E_INTEROP=1`). `tests/e2e/plugins/interop-modules.json` pins five public modules by their wheel on PyPI and its SHA-256: wigglystuff's Slider2D, Matrix and TangleSlider, drawdata's ScatterWidget and mopaint's Paint, with the traits their Python classes default to. The test fetches each wheel, checks it, and takes the module (and its style sheet) out unmodified; nothing of them is committed. A package of the test's own carries the module as an asset: its entry reads it with `core:asset:read`, imports it from a Blob URL, sets the traits a kernel would have sent as frame-local ones, and hands it `initialize` and `render`. Each must draw into the frame with no failure on the card.
