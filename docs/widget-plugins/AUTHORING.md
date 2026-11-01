# Writing a widget plugin

Files: [README](README.md) · **AUTHORING** · [WIDGETS-JSON](WIDGETS-JSON.md) · [SECURITY](SECURITY.md)

The reference for people who build widget plugins for FINOS Workspace. README says how a deployment runs plugins and SECURITY what the sandbox enforces; this file says what to write.

## 1. What a plugin is

A plugin is a package of files that adds widget types to FINOS Workspace. Its code is an [Anywidget front-end module](https://anywidget.dev/en/afm/) (AFM 0.11): the same `render({ model, el })` contract that Jupyter widgets use.

- **It is placed, not installed.** Whoever deploys FINOS Workspace puts the package in the API's plugins directory. Nothing in the app uploads, fetches or installs a plugin.
- **It is reviewed before it runs.** A superuser reads what the version asks for and approves it. An organization's admin enables it and grants it to roles. A new version never replaces the active one until it is approved.
- **It runs in a sandboxed frame.** Each widget instance gets its own `iframe` with an opaque origin, no storage, no cookies, no popups, and a Content Security Policy that allows no network unless the plugin declares hosts and an admin approves them. The host checks everything the frame asks for against the plugin's permissions.
- **It never sees credentials.** The host fetches a widget's data and pushes it into the frame. A call that needs a key goes through a declared proxy or the plugin's own backend: the server adds the secret.

## 2. The package

```
<plugin-id>/<version>/
  plugin.json        the manifest (section 3)
  entry.js           the module, one bundled file
  entry.css          optional styles
  assets/            optional: the icon, and files the module reads with core:asset:read
  skills/            optional: one markdown file for each skill the plugin gives the agent (section 3.2)
```

- `<plugin-id>`: 2 to 48 characters, lowercase letters, digits and `-`, starting with a letter.
- `<version>`: `major.minor.patch`, numbers only. An approved version is immutable: change anything and publish a new version directory. On your own machine the app starts one for you (section 11).
- File names: letters, digits, `.`, `_`, `-`. No symbolic links. At most 200 files and 64 MiB per version by default (the deployment can lower or raise these).
- `plugin.json` is at most 256 KiB.
- The frame receives `entry.js` and the styles. A file under `assets/` reaches it when the module asks for it: `invoke("core:asset:read", { path: "assets/<file>" })` resolves to `[{ path, size }, [bytes]]`, checked against the approved version like the module (section 4.3). Make a `blob:` URL of the bytes for an image, a font, a worker or a WebAssembly binary. Nothing else in the package reaches the frame: not `plugin.json`, not `backend/`.

## 3. The manifest

```jsonc
{
  "manifestVersion": 1,
  "id": "<plugin-id>",
  "version": "1.0.0",
  "name": "<name shown to admins and users>",
  "description": "<one or two sentences>",
  "publisher": { "name": "<who publishes it>", "url": "https://<publisher site>" },
  "icon": "assets/icon.svg",
  "host": { "api": 1, "afm": "0.11" },
  "checksum": "sha256-<printed by plugin_check --digest>",
  "entry": { "module": "entry.js", "styles": ["entry.css"] },
  "csp": { "img-src": ["https://<tile host>"] },
  "cspNotes": { "img-src": "<why the frame loads images from that host>" },
  "secrets": [{ "name": "<secret_name>", "purpose": "<what the key is for>" }],
  "server": { "network": ["https://<api host>"], "proxies": [] },
  "adminSettings": { "schema": {}, "defaults": {} },
  "contributes": { "widgets": [] }
}
```

The manifest is closed: an unknown key blocks the version. Strings and lists are bounded.

| Key | Required | What it is |
|---|---|---|
| `manifestVersion` | yes | `1`. |
| `id`, `version` | yes | The same as the directories that hold the package. |
| `name` | yes | 1 to 80 characters. |
| `description` | no | At most 300 characters. |
| `publisher` | yes | `name` (1 to 100 characters) and an optional `https://` `url`. Shown to admins as the package states it, not verified. |
| `icon` | no | A file under `assets/`. |
| `host` | yes | `api: 1` and `afm: "0.11"`: the host API and the AFM version you build against. A host that implements other versions blocks the package. |
| `checksum` | yes | `sha256-` and the base64url SHA-256 of the sorted lines `<path>\0<sha256 hex of the file>\n` of every file except `plugin.json`. `plugin_check --digest` prints it. |
| `entry` | yes | `module`: a `.js` file. `styles`: up to 8 `.css` files. Neither under `backend/`. |
| `csp`, `cspNotes` | no | What the frame may reach itself (section 6), and a sentence per directive explaining why. |
| `secrets` | no | Up to 16 secrets your proxies send, by `name` (lowercase letters, digits, `_`) and `purpose` (at most 300 characters). Never a value. |
| `server` | no | `network`, the https origins the server may call for you (and, for a backend, the `tcp://host:port` endpoints it opens), `proxies`, the requests it makes (section 7), and `backend`, your own server-side code (section 8). |
| `dataSources`, `identity` | no | For a backend (section 8): the data it reads for the user, by `id` and `purpose`, and `"pseudonymous"` to learn an anonymous id of the user (default `"none"`). |
| `adminSettings` | no | A settings form an organization's admin fills in (section 9). Not for secrets. |
| `contributes.widgets` | yes | 1 to 20 widgets (below). |
| `contributes.skills` | no | Up to 20 skills for the agent (section 3.2). |

A manifest that asks for the permission `core:data:query` or has `signatures` is blocked: neither exists on this host.

### 3.1 Widgets

```jsonc
{
  "id": "<widget-id>",
  "name": "<name in Add widget>",
  "description": "<what it shows>",
  "category": "<category in Add widget>",
  "handles": [
    {
      "type": "<viz type>",
      "definition": { "type": "object", "additionalProperties": false, "properties": {} },
      "response": { "accepts": "json", "description": "<what the backend returns>" }
    }
  ],
  "standalone": false,
  "artifact": { "description": "<when the agent shows it>", "data": { "type": "object", "additionalProperties": false, "properties": {} } },
  "permissions": ["core:data:read"],
  "server": { "proxies": [] },
  "model": { "traits": {} },
  "params": [],
  "settings": { "schema": {}, "defaults": {} },
  "grid": { "w": 20, "h": 12 }
}
```

| Key | What it is |
|---|---|
| `id` | 1 to 48 characters, lowercase letters, digits, `_` and `-`, starting with a letter. Unique in the plugin. |
| `name`, `description`, `category`, `subCategory` | What Add widget shows. |
| `handles` | Up to 8 viz types this widget renders for backend widgets (`"type"` in a backend's `widgets.json`). A type is 2 to 32 lowercase characters and cannot be a built-in type (`markdown`, `html`, `iframe`, `newsfeed`, `pdf`). `definition` is the JSON Schema of the `data.<type>` object a backend writes for it (section 9); `response` describes the JSON the backend's endpoint returns. |
| `standalone` | `true` lists the widget in Add widget on its own, with no backend. A widget handles at least one type or is standalone. |
| `artifact` | Lets the AI Agent show the widget in the chat with data it chooses (section 3.3). |
| `permissions` | The host permissions it asks for (section 5). |
| `server.proxies` | The ids of the proxies it may call; it then needs `core:proxy:call`, and only then. |
| `server.routes` | The ids of the backend routes it may call; it then needs `core:backend:call`, and only then. |
| `model.traits` | Your trait names bound to host state (section 4.2). |
| `params` | Parameters of a standalone widget, as in `widgets.json` (`paramName`, `type`, `value`, `label`, ...). Each has a unique `paramName`. |
| `settings` | A form the user edits per widget instance (section 9). |
| `grid` | Default size on the 40-column dashboard grid: `w` 1 to 40, `h` 1 to 100, optional `minW` and `minH`. |

One plugin cannot handle the same type twice. When two plugins handle a type, the organization's admin chooses which renders it.

A type you handle works with any backend whose `widgets.json` declares a widget of that type and whose endpoint returns what `response` describes. FINOS Workspace adds `theme=dark` or `theme=light` to that endpoint's query, the site's mode, and asks again when the user switches it, as it does for `markdown` and `html`. What each mode looks like is the backend author's to decide. `theme` and `raw` (4.2) are names the backend's widgets cannot use for query params of their own.

### 3.2 Skills

A plugin can give the agent skills: instructions it follows for one kind of task, such as how to ask for the data a widget needs. Each skill is a markdown file under `skills/` and an entry in `contributes.skills`:

```jsonc
"contributes": {
  "widgets": [],
  "skills": [
    { "slug": "forecast-charts", "description": "How to draw a forecast", "file": "skills/forecast.md" }
  ]
}
```

| Key | What it is |
|---|---|
| `slug` | 2 to 50 characters: lowercase letters, digits and single `-`. Unique in the plugin. The user starts the skill with `/skill:<slug>`, and the agent can pick it up from its description. |
| `description` | One line, at most 300 characters, which tells the agent when to use the skill. |
| `file` | `skills/<name>.md`, UTF-8 text that is not empty and is at most 32 KiB. Unique in the plugin. |

The skills of a plugin that is approved and enabled for an organization appear in the Skills tab of every user of that organization, with the plugin's name and without edit or delete. They need no role grant. They go when the plugin is disabled or a later version drops them. A skill the user made with the same slug wins, and when two plugins use one slug the one whose id comes first in the alphabet wins. A skill file is part of the package: the version's checksum covers it, the reviewer sees each skill in the review and acknowledges it, and a file that differs from the approved one is not given out. A skill is text for the model, so it cannot run code or call tools by itself.

### 3.3 Artifacts

A widget with `artifact` is a component the AI Agent can use in the chat: it shows the widget under its answer, filled with data it has from the conversation or from the tables it loaded. The user can add the card to a dashboard as a widget of the plugin, which keeps that data.

```jsonc
"artifact": {
  "description": "Bars of x labels and y values, for a comparison across a few categories",
  "data": {
    "type": "object",
    "additionalProperties": false,
    "required": ["rows"],
    "properties": {
      "title": { "type": "string", "maxLength": 80 },
      "rows": {
        "type": "array",
        "maxItems": 200,
        "items": { "type": "object", "additionalProperties": false, "required": ["x", "y"], "properties": { "x": { "type": "string", "maxLength": 40 }, "y": { "type": "number" } } }
      }
    }
  }
}
```

| Key | What it is |
|---|---|
| `description` | At most 300 characters. Tells the agent when the component fits the question. |
| `data` | The JSON Schema of the data the agent gives, in the form of a `definition` (section 9): an object, closed and bounded. The agent reads it to build the data, the agent drops what it does not name, and data over 256 KiB is refused. |

Nobody who wrote the data themed it: the widget follows the `theme` trait (4.2) for what the data leaves open. The widget reads the data through its `data` trait, so it needs the permission `core:data:read` and, when it declares `model.traits`, a trait bound to `data` (4.2). Its `settings` (section 9) are the agent's `config`. In the chat the widget is read-only and runs with `core:data:read`, `core:ui:notify`, `core:clipboard:write` and `core:asset:read`; a proxy or backend call, a write to params or state, a link or a download work once the widget is on a dashboard. A widget on a dashboard made from an artifact has no endpoint, so its `data` trait is the data it was made with.

The artifact is part of the version the reviewer approves: the review lists it, and a change to its description or its data schema is asked for again. Only users whose roles grant the widget (section 5) are offered it, and the agent is told of the components of the plugins that are approved and enabled for the user's organization.

## 4. The module

`entry.js` is one bundled ES module whose default export is the widget, or an async function that returns it. Only the default export is used.

```js
export default {
  async initialize({ model, signal, experimental }) {},
  async render({ model, el, signal, host, experimental }) {
    const draw = () => {
      el.textContent = JSON.stringify(model.get("data"));
    };
    model.on("change:data", draw);
    draw();
    return () => model.off("change:data", draw);
  },
};
```

`initialize` runs once per frame, before `render`, and returns nothing, a cleanup function, or the exports of section 4.5.

### 4.1 Lifecycle

1. The frame starts, checks its sandbox and policy, and receives your verified files and the initial value of every bound trait.
2. `await initialize(...)`, then `await render(...)`. Each has 15 seconds. If one throws or rejects, the next does not run, `signal` aborts, and the card shows an error with your message.
3. While it runs: host pushes fire `change:<trait>`; you write with `set` and `save_changes`; you call host commands with `experimental.invoke`; the host calls your exports.
4. When the widget is removed or reloaded: `signal` aborts, each cleanup you returned runs once, `el` is emptied, and the frame goes.

Every frame runs its own `initialize`, a fullscreen view included. Do not rely on state shared between views. Size yourself with a `ResizeObserver` on `el`; the host sizes the frame.

`render` can run before the frame has a size: a dashboard places its cards after their frames start, so `el` may be 0×0 at first. Text measures zero width in a frame with no size. A library that measures text when it draws (a chart's legend or axis labels) and keeps the measurement draws wrong from then on. Draw once `el` has a size, and draw again when it gets one.

### 4.2 The model

| Method | Behavior |
|---|---|
| `model.get(name)` | A copy of the trait's value. Change it with `set`. |
| `model.set(name, value)` | Sets the local value and fires `change:<name>`. |
| `model.save_changes()` | Sends the changed traits that are bound and writable. The host echoes what it accepted; a refused write is echoed with the previous value, which fires `change:` again. |
| `model.on(event, callback)`, `model.off(event?, callback?)` | `change:<name>` callbacks get no arguments. `off()` removes everything; `off(event)` that event's listeners. |
| `model.send(content, callbacks, buffers)` | Only anywidget's own `invoke` message (`kind: "anywidget-command"`) is answered, as a `msg:custom` with the same `id`. Anything else is dropped. |
| `model.on("msg:custom", (content, buffers) => ...)` | Host events: `{ kind: "workspace-event", name: "refresh" }` when the user refreshes, and `{ kind: "workspace-event", name: "visibility", visible }`. |

Traits are bound to host state. Without `model.traits`, they take these names:

| Trait | Value | Writable |
|---|---|---|
| `data` | The JSON the widget's backend endpoint returned (after `dataKey`), or its rows when the user shows them (below). Only with `core:data:read`. | no |
| `params` | The widget's params as `{ name: value }`. | with `core:params:write`, declared names only |
| `definition` | The `data.<type>` object of the backend widget, checked against your `definition` schema. | no |
| `config` | The instance's settings (section 9). | no |
| `adminSettings` | The organization's admin settings. | no |
| `state` | Your own instance state, saved with the dashboard, at most 64 KiB of JSON. | with `core:state:write` |
| `theme` | `{ mode, tokens, locale, decimals }`. Follow it, and react to `change:theme`. | no |
| `capabilities` | Your effective permissions. Check them before calling a command. | no |
| `meta` | `{ pluginId, version, widgetId, instanceId }`. | no |

A backend widget with `raw` (WIDGETS-JSON 4.11) has a button that shows its rows instead of its view. When it has no `data.rawType`, or one the user may not use, your module shows them: `data` is then the rows, typically an array of objects, and the frame starts again with them, and again when the user switches back. Show them as a table, or say they cannot be shown. The AI Agent gets the rows either way, so `copilotContext` (4.5) is not asked for a widget with `raw`.

To keep an existing module's trait names, bind them: `"model": { "traits": { "rows": { "bind": "data" }, "filter": { "bind": "param:filter", "access": "readwrite" } } }`. A binding is one of the names above, `param:<name>`, `config:<key>` or `adminSettings:<key>`; only `params`, `param:<name>` and `state` can be `readwrite`. A trait with no binding stays in the frame.

### 4.3 Commands

`experimental.invoke(name, msg, { buffers, signal, timeout })` resolves to `[value, DataView[]]`. It times out after 10 seconds unless you pass `timeout` or a `signal`. Buffers are `ArrayBuffer`s or typed arrays.

| Command | Permission | Message | Limits |
|---|---|---|---|
| `core:asset:read` | `core:default` (always) | `{ path }`, a file under `assets/` | Resolves to `{ path, size }` and the file as the one buffer. The file is checked against the approved version; another path is `invalid_args`, a file the version does not have `out_of_scope`. Pass a longer `timeout` for a large file. |
| `core:ui:notify` | `core:ui:notify` | `{ level, text }`, level `info`, `success`, `warning` or `error` | Plain text, 500 characters, shown with the plugin's name, rate limited. |
| `core:ui:open-link` | `core:ui:open-link` | `{ url }` | `https:` and `mailto:` only, after the user confirms. |
| `core:clipboard:write` | `core:clipboard:write` | `{ text }` | 1 MiB, after a click in the widget. |
| `core:download:save` | `core:download:save` | `{ filename, mime }`, the file as the first buffer | 25 MiB; the name is cleaned. |
| `core:proxy:call` | `core:proxy:call` | `{ id, args }` | A proxy the widget declares (section 7). Resolves to the response body. |
| `core:backend:call` | `core:backend:call` | `{ route, args }` | A route of your backend the widget declares (section 8). Resolves to its JSON. |

A refused call rejects with an `Error` whose `name` is `not_granted`, `invalid_args`, `out_of_scope`, `rate_limited`, `too_large`, `unknown_command`, `timeout` or `unavailable`. At most 32 calls may be waiting at once.

### 4.4 Errors and budgets

Uncaught errors and unhandled rejections are logged, not fatal. The frame has a message budget (about 100 messages a second, bursts of 200, 1 MiB each). Breaking it, sending what the protocol does not know, or failing three times in ten seconds ends the frame, and the card shows why. A frame that stops answering the host's pings is ended as unresponsive.

### 4.5 Exports

`initialize` may return an object instead of a cleanup function. The host calls its members:

```js
async initialize({ model }) {
  return {
    async exportOptions() {
      return [{ id: "rows", label: "Rows (CSV)", extension: "csv", mime: "text/csv" }];
    },
    async exportData(id, { title }) {
      return toCsv(model.get("data"));
    },
    async copilotContext() {
      return { rows: model.get("data")?.length ?? 0 };
    },
  };
}
```

- `exportOptions` returns what the widget can export now, `[]` for nothing. `exportData` returns a string, an `ArrayBuffer`, a typed array or a `Blob`, or `null` for nothing.
- The card's Export entry appears with `core:export:provide` and both `exportOptions` and `exportData`. At most 16 options; ids are letters, digits, `_`, `.` and `-`; labels 1 to 60 characters; extensions 1 to 10 letters or digits; `mime` is `type/subtype`. The file is at most 25 MiB. `exportOptions` has 10 seconds, `exportData` 60.
- `copilotContext` is called with `core:copilot:context` when the user asks the AI agent about the dashboard. At most 256 KiB, 10 seconds.
- When `initialize` returns exports, do cleanup through `signal`.

### 4.6 Against anywidget in Jupyter

| In Jupyter | Here |
|---|---|
| A Python class holds the traits, and the kernel answers `model.send` | No kernel. Traits are bound to host state (4.2). A round trip to server code is a proxy (section 7) or a backend route (section 8). |
| `_esm` and `_css`, which may be URLs | `entry.js` and `entry.css` from the package, bundled. CSS is added as a `<style>` element. |
| `host.getWidget`, `host.getModel`, `model.widget_manager` | Reject with `not_available`: a widget reaches no other widget. |
| Views of one model share its `initialize` | Every frame runs its own `initialize`, a fullscreen view included. |
| `experimental.invoke` calls Python | It calls a host command (4.3). |
| The page's storage, cookies, popups and network | None. Storage and cookies are unavailable in the frame's opaque origin, popups, alerts and navigation are blocked, and the network is what the frame's policy allows (section 6). |

## 5. Permissions

| Permission | Gives |
|---|---|
| `core:default` | The lifecycle, error reporting and logs. Always granted. |
| `core:data:read` | The `data` trait. |
| `core:params:write` | Writes to `params` and `param:<name>`, declared names only, values coerced to the param's type. |
| `core:state:write` | Writes to `state`. |
| `core:copilot:context` | The host may call `copilotContext()`. |
| `core:export:provide` | The Export entry calls `exportOptions()` and `exportData()`. |
| `core:ui:notify`, `core:ui:open-link`, `core:clipboard:write`, `core:download:save`, `core:proxy:call`, `core:backend:call` | The commands of section 4.3. |

Ask only for what the widget uses. An organization can remove permissions for its users, so read `capabilities` and degrade.

## 6. The frame's network

The frame starts with no network: `connect-src`, `frame-src` and remote images, fonts, media, styles and scripts are closed. `data:` and `blob:` work for images, fonts and media, `blob:` for scripts, styles and workers, and inline styles are allowed. Declare what you need in `csp`:

```jsonc
"csp": { "img-src": ["https://tiles.example.org"], "connect-src": ["https://api.example.org"] },
"cspNotes": { "img-src": "Map tiles", "connect-src": "Live prices" }
```

- Directives: `connect-src`, `img-src`, `font-src`, `media-src`, `style-src`, `script-src`, `worker-src`, `frame-src`.
- Sources: an `https://` (or, in `connect-src`, `wss://`) host with an optional port and path, a `*.` wildcard of at least two labels, `data:`, `blob:`, `'none'`, `'unsafe-inline'` in `style-src`, `'unsafe-eval'` and `'wasm-unsafe-eval'` in `script-src`, and hashes in `script-src` and `style-src`. Nothing broader.
- An author cannot ask for plain `http:` or `ws:`, an IP address or a private host (`localhost`, a name ending in `.localhost`, `.local`, `.internal`, `.home.arpa` or `.lan`, or a name without a dot), or a remote `script-src` host. A superuser can allow them in an override; the package cannot.
- What the frame can reach, it can send the data it shows to. Admins see that in the review. When a call needs a key, or returns data that should not show in the browser's network panel, use a proxy instead.
- Remote `import` and `import()` fail unless `script-src` allows the origin. Bundle instead.
- **Workers.** Start them from a `blob:` URL (`worker-src` has `blob:`; a `data:` URL needs `worker-src data:`). Use classic workers: a module worker from a `blob:` URL does not start in Chromium in an opaque-origin frame, though Firefox and WebKit start one. What a worker's policy blocks is reported to the admin like the frame's (in Chromium and Firefox; WebKit reports nothing from workers, though it refuses the same requests). You may revoke the worker's URL right after `new Worker(url)`.

## 7. Proxies and secrets

A proxy is a request the server makes for your widget, from a template in the manifest. The frame names the proxy and gives arguments; it never builds a URL or a header, and never sees a secret.

```jsonc
"secrets": [{ "name": "api_key", "purpose": "Reads quotes from the quote service" }],
"server": {
  "network": ["https://quotes.example.org"],
  "proxies": [
    {
      "id": "quote",
      "method": "GET",
      "url": "https://quotes.example.org/v1/quotes/${arg:symbol}",
      "query": { "period": "${arg:period}" },
      "headers": { "Authorization": "Bearer ${secret:api_key}" },
      "args": {
        "symbol": { "type": "string", "maxLength": 12, "required": true },
        "period": { "type": "enum", "values": ["day", "week"] }
      },
      "response": { "accepts": ["application/json"], "maxBytes": 1048576, "timeoutMs": 10000 }
    }
  ]
}
```

```js
const [quote] = await experimental.invoke("core:proxy:call", {
  id: "quote",
  args: { symbol: "IBM", period: "day" },
});
```

The widget lists `"server": { "proxies": ["quote"] }` and the permission `core:proxy:call`.

| Part | Rules |
|---|---|
| `id` | Lowercase letters, digits, `_` and `-`, unique in the plugin. |
| `method` | `GET` or `POST`. |
| `url` | `https://`, a literal host and port on `server.network`, no query or fragment. `${arg:<name>}` only in the path, after the host; the value is encoded as one path segment and is required. |
| `query` | Up to 32 literal names; values may hold `${arg:<name>}`. A value whose argument is absent is left out. |
| `headers` | Up to 16; values may hold `${secret:<name>}`, nothing else. Headers that change how a request travels (`Host`, `Content-Type`, `Content-Length`, `Cookie`, `Accept-Encoding`, `Forwarded`, `X-Forwarded-*`, `Sec-*`, `Proxy-*` and the like) cannot be set. Printable ASCII only. |
| `body` | `POST` only: a flat object of literal names. A field that is exactly `${arg:<name>}` keeps the argument's type; text around a token makes a string; a field whose argument is absent is left out. Sent as JSON. |
| `args` | Up to 32: `string` (with `maxLength`, default 256), `number` (with `minimum` and `maximum`), `boolean`, or `enum` (with `values`). `required` makes one mandatory. Unknown arguments are refused. |
| `response` | `accepts`: one or more of `application/json`, `text/plain`, `text/csv`, `text/markdown`, `text/html`, `application/xml` (default JSON). `maxBytes` up to 25 MiB (default 1 MiB), `timeoutMs` up to 30 seconds (default 10). The deployment caps both, by default at 5 MiB and 30 seconds. |

- A `${secret:...}` is never allowed in the URL, the query or the body, so a key never lands in a URL or a log.
- For proxies, `server.network` lists https origins, with the same host rules as the CSP (no IP address or private host). Every proxy's host must be on it. A `tcp://` entry is a backend's (section 8), never a proxy's.
- The server resolves the host itself and refuses a name that resolves to a private, loopback, link-local or metadata address. It does not follow redirects. It asks for an uncompressed answer and refuses a compressed one. A non-2xx answer comes back as an error naming only its status class; only the `Content-Type` of the answer is kept.
- The call resolves to the body: parsed JSON for `application/json`, text otherwise. A refusal rejects with one of the names of section 4.3 (`invalid_args` for bad arguments, `not_granted` when the permission was removed, `out_of_scope` for a proxy the widget does not list, `rate_limited`, `timeout`, `too_large`, otherwise `unavailable`, for example when a secret is not set or the upstream failed).
- Calls are rate limited per user and per plugin. Declare secrets you need, and none you can avoid. The deployment or a superuser sets their values; you never ship one.

## 8. A backend

When the work cannot run in the browser or be written as a request template, the package can carry server-side code in `backend/`. Whoever deploys FINOS Workspace builds it, runs it as its own restricted process (a container with no privileges, no mounts of the deployment, and no network but a gateway to the API and an egress point to the hosts the admin approved), and lists it in `WIDGET_PLUGIN_BACKENDS`. The API is its only caller.

```jsonc
"secrets": [{ "name": "model_key", "purpose": "Authenticates to the forecast model" }],
"dataSources": [{ "id": "sales", "purpose": "The sales of the user's organization" }],
"identity": "pseudonymous",
"server": {
  "network": ["https://models.example.org"],
  "backend": {
    "protocol": 1,
    "routes": [
      {
        "id": "forecast",
        "args": { "region": { "type": "string", "maxLength": 8, "required": true } },
        "secrets": ["model_key"],
        "response": { "maxBytes": 1048576, "timeoutMs": 10000 }
      }
    ]
  }
}
```

The widget lists `"server": { "routes": ["forecast"] }` and the permission `core:backend:call`, and calls it:

```js
const [forecast] = await experimental.invoke("core:backend:call", {
  route: "forecast",
  args: { region: "emea" },
});
```

The backend answers three requests, over HTTP on its internal address:

| Request | Answer |
|---|---|
| `GET /.workspace/identity` | `{ "plugin": "<id>", "version": "<version>", "digest": "<version digest>", "protocol": 1 }`. The digest is what `plugin_check --digest` prints for the package the backend was built from. The API routes nothing to a backend whose answer is not the approved version's. |
| `GET /.workspace/health` | Any 200. |
| `POST /.workspace/routes/<route-id>` | Body `{ "args": {...}, "widget": { "id", "instanceId" }, "caller": {} }`, with `X-Workspace-Call: <token>` and, for each secret of the route, `X-Workspace-Secret-<name>` (underscores in the name become hyphens). Answer with JSON within the route's limits. |

- **Network.** `server.network` names what the backend contacts: https origins, and `tcp://host:port` for anything else, such as a database. The deployment enforces it around the backend. A host that belongs to the deployment rather than your package, such as its database, is added by a superuser's override; name it in your `purpose` texts and README.
- **Arguments** are checked by the API against the route's `args` before the call (the types of section 7). A route's string may have a `maxLength` up to 32,768, since it travels in the call's JSON body; a proxy's stays at 2,048.
- **The caller** is `{}`, or `{ "id": "<pseudonymous id>" }` when the admin approved `identity: "pseudonymous"`: stable for a user within your plugin, different in every other plugin, and never the user's name, email or FINOS Workspace id.
- **Data of the user.** To read a data source you declare, send the call's token to the broker: `POST <API>/internal/plugin-broker/data/<data-source-id>` with `X-Workspace-Call: <token>`, `Origin: <the web app's origin>` (the deployment gives your backend that value; the API refuses a request from an origin it does not allow) and `{ "path": "/<path under the backend's URL>", "method": "GET", "query": {...}, "body": ... }`. It answers `{ "status", "content_type", "body" }`. The organization chooses which of its backends serves each data source, the user's own access applies, and the backend's credentials are added by the API; you never hold them. The token lasts 60 seconds and cannot be read or changed.
- **Limits.** A route's `maxBytes` is at most 5 MiB (default 1 MiB) and `timeoutMs` at most 30 seconds (default 10); the deployment caps both. Calls are rate limited and at most 8 of a plugin run at once. After repeated failures (time-outs, errors, a 5xx) the API pauses calls to the backend for a short time. A 4xx you return is passed on as a refusal and does not count.
- **In the frame,** a refused call rejects with `out_of_scope` for a route the widget does not list, `invalid_args`, `not_granted`, `rate_limited`, `timeout`, `too_large`, and otherwise `unavailable` (not registered, another version, paused, a secret not set, your error).
- **The admin reviews** that code runs on the server, each route and the secrets it sends, each data source and the pseudonymous id.

## 9. Schemas

**`definition`** (the `data.<type>` object a backend writes for your type) is a closed, bounded JSON Schema of at most 64 KiB and 8 levels: objects have `additionalProperties: false` (or a value schema, for a map), arrays have `maxItems` and `items`, strings have `maxLength`, `enum`, `const` or `pattern`. Keywords: `type`, `properties`, `required`, `additionalProperties`, `items`, `enum`, `const`, `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `minLength`, `maxLength`, `pattern`, `minItems`, `maxItems`, `uniqueItems`, `oneOf` and `anyOf` over closed objects, local `$defs` and `$ref`, and the annotations `title`, `description`, `default`, `examples`. Patterns are at most 256 characters, without backreferences. Backends' widgets are checked against it, and the AI agent reads it when it builds widgets of your type.

**`settings` and `adminSettings`** are forms the host renders: a flat object of at most 64 properties (names of letters, digits and `_`), each a `string` (with `maxLength`), `number`, `integer`, `boolean` or `enum`, with optional `title`, `description`, `default`, `minimum`, `maximum`, and an optional `required`. `defaults` must satisfy the schema. Instance settings are at most 32 KiB.

## 10. Checking a package

From `backend-api/backend` in the FINOS Workspace repository, run the server's own validator, offline:

```
python -m scripts.plugin_check <plugins dir>/<plugin-id>/<version>
python -m scripts.plugin_check --digest <plugins dir>/<plugin-id>/<version>
```

The first runs discovery as the server does (files, links, caps, the manifest, the CSP, proxies, the checksum) and exits 1 with the reasons when the version would be blocked. Warnings, such as a remote import or `eval` without `'unsafe-eval'`, do not block. `--digest` prints the `checksum` to write into `plugin.json` and the version digest a deployer can pin.

## 11. Developing

Develop on your own machine, with the repository's local stack (`local/LOCAL_SETUP.md`, section Widget plugins) or its root `docker-compose.yml`, where you are the administrator and the plugins directory is `widget-plugins/` at the repository root. Both run with `MODE=local`. Deployments, including those built from the `develop` and `main` branches, run with `MODE=production`, and none of the steps from 4 on exist there.

1. Mount a plugins directory into the API, writable, and set `WIDGET_PLUGINS_DIR`.
2. Build the first version into `<dir>/<id>/<version>/` and check it (section 10).
3. In Admin, Widgets, Deployment: Rescan, review, approve. Under Plugin widgets, enable it, and in Roles and Access grant it to a role you hold. Add the widget to a dashboard.
4. On the plugin's Deployment page, choose Patch, Minor or Major. The API copies the active version to the next version number, rewrites the copy's `version` and `checksum`, and marks it `development`.
5. Edit the copy's files, or build into its directory. The app serves them as they are: a dashboard reads the plugin list when its window gets focus and every minute, and a frame restarts when the files changed. An edit does not block the copy, a `checksum` that no longer matches is a warning, and the manifest's other declarations (the policy, proxies, routes, the widgets' `definition`s) apply as you change them. A copy that fails a check is not served; the Deployment page says why.
6. When it is done, write its `checksum` (`plugin_check --digest`, or your build), then approve it, which makes it the active version, or commit its directory and open a pull request. A deployment discovers it as a new version, and its superuser reviews and approves it.

An approved version is never edited: changing its files blocks it. One version of a plugin is in development at a time; deleting its directory and rescanning ends it.

A widget of a type you handle can read a deployed data backend: add it to your local stack as a connection with your own key, read-only where the backend has such keys, and have the backend allow your local web app's origin. The deployment's agent and its plugin backends accept only that deployment's sessions and call tokens, so a local stack cannot use them or write to them: run them locally (the root `docker-compose.yml` runs the agent, and `docs/examples/sql-explorer/examples/compose.yaml` shows a plugin backend).

For proxies, set the secret on the plugin's Deployment page. A service on your own machine or network resolves to a private address, which needs a superuser's server network override with private hosts confirmed; a private certificate authority needs `WIDGET_PLUGIN_PROXY_CA_FILE`.

## 12. Porting an existing anywidget

1. Take the `_esm` and `_css` of the Python package and bundle them into `entry.js` and `entry.css`, with dynamic imports inlined and no CDN imports.
2. Map its trait names in `model.traits`.
3. Replace what the Python side did: data comes from a backend endpoint through `data`, settings through `config`, and a round trip to code on a server through a proxy or a route of your own backend (section 8). Kernel messages do not exist.
4. Remove storage, popups, alerts and cookies; keep preferences in `state`.
5. Check it (section 10) and try it in your own FINOS Workspace, where the first failures are usually storage access and remote imports.

## 13. Before you publish

- Every permission, CSP source, server host and secret is one the widget uses, with a `cspNotes` line per directive.
- The module works when a permission it asks for is removed.
- It follows `theme` and resizes with `el`.
- It cleans up through its cleanup function or `signal`.
- `plugin_check` passes, and the `checksum` is current.
