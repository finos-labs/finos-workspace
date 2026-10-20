# Widget plugins: design

Status: proposal, 2026-10-09. Nothing in this folder changes code.

Files: [README](README.md) · **DESIGN** · [GUEST-CONTRACT](GUEST-CONTRACT.md) · [WIDGETS-JSON](WIDGETS-JSON.md) · [SERVER-SIDE](SERVER-SIDE.md) · [SECURITY](SECURITY.md) · [PLAN](PLAN.md) · [SPIKE](SPIKE.md) · [AUTHORING](AUTHORING.md)

This file covers the runtime, how plugins reach a deployment, the manifest, registration, RBAC, the backend API and the admin UIs. The module contract that plugin code is written against is in GUEST-CONTRACT. Proxies, secrets and plugin backends are in SERVER-SIDE. The sandbox, the CSP model and the threat model are in SECURITY.

## Contents

1. [Goals, non-goals, terms](#1-goals-non-goals-terms)
2. [The Tauri model, mapped](#2-the-tauri-model-mapped)
3. [Architecture](#3-architecture)
4. [Packages, installation and lifecycle](#4-packages-installation-and-lifecycle)
5. [Registration in the host](#5-registration-in-the-host)
6. [RBAC and who may do what](#6-rbac-and-who-may-do-what)
7. [Backend API](#7-backend-api)
8. [Admin UIs](#8-admin-uis)
9. [What users see](#9-what-users-see)
10. [Versions, updates, removal](#10-versions-updates-removal)
11. [Audit and observability](#11-audit-and-observability)
12. [Developing a plugin](#12-developing-a-plugin)
13. [References](#13-references)

## 1. Goals, non-goals, terms

**Goals**

1. Admins can install and register plugins at the **deployment level only**. The deployer puts packages where the server can read them; the app never installs code.
2. The admin UI separates core widgets from plugin widgets. Plugins are disabled by default and need an explicit enable, and a role that grants them.
3. Every widget runs as an isolated window. It cannot read or affect what other widgets render, and it cannot reach the host app's session or credentials.
4. Security responsibility rests with the admin, and the product makes that easy to exercise: each plugin's manifest, integrity and requests are shown before anything is enabled, and every change since the version in use is shown before an update takes effect.
5. Backends keep using `widgets.json`. A backend widget whose `type` is, say, `table` or `chart` renders through whichever enabled plugin handles that type.
6. Everything plugs into the existing admin UIs, the `workspace-admin` CLI and the existing RBAC (entities, roles, audit). There is no parallel permission system.

**Non-goals**

- No user-facing install, upload or "bring your own plugin" path. No flow where a user builds a plugin and asks an admin to promote it. Anyone who wants to experiment runs their own copy of Workspace as the admin of that instance (section 12).
- No install, upload or download of code from the app, for anyone. A web session cannot deploy code.
- No plugin source in this repository, AgGrid and Plotly packages included.
- No plugin code in the API or the worker process. Server-side plugin code, when there is any, is a separate restricted process (SERVER-SIDE).
- No plugin enabled by installation, and no update that takes effect without an admin action.
- No claim that a plugin is safe. The product limits what a plugin can reach and informs the admin; the admin owns the decision to trust it.
- The built-in widgets (`markdown`, `html`, `iframe`, `newsfeed`, `pdf`, `navigation_bar`) do not change, and neither does how the Iframe and HTML widgets behave today.

**Terms**

| Term | Meaning |
|---|---|
| Host | The Workspace SPA (`frontend/`). |
| Runtime | The host-side code of this design: registry, bridge, runtime authority, frame manager. |
| Deployer | Whoever builds and runs the deployment. Puts plugins on the server. |
| Admin | In the UI, a superuser (the deployment's admin) and an entity admin. DESIGN 6.2 says who may do what. |
| Plugin | An external package that contributes widget types. Identified by `id` and `version`. |
| Plugins directory | The server-side directory the deployer points `WIDGET_PLUGINS_DIR` at. |
| Widget type | A `(plugin id, widget id)` pair declared in the manifest. |
| Instance | One widget of that type placed on a dashboard. |
| Frame | The sandboxed `<iframe>` that runs one instance. |
| Shell | The small host-owned document inside the frame that loads the plugin's module. |
| Model | The Anywidget-style state object the plugin reads and writes (GUEST-CONTRACT). |
| Permission | A named host capability such as `core:data:read`, checked by the runtime authority on each call. |
| CSP policy | The Content Security Policy of the frame: declared by the author, approved or overridden by the admin, enforced by the browser (SECURITY 4). |
| Tier | T0 frontend only, T1 plus declarative proxies, T2 plus a plugin backend (SERVER-SIDE). |
| Trust summary | The admin screen that shows what a plugin is, its integrity and what it asks for (section 8.2). |

## 2. The Tauri model, mapped

The shape of the system follows Tauri's plugin architecture. The Tauri facts below come from its documentation (links in [References](#13-references)).

| Tauri | Here | Note |
|---|---|---|
| A plugin is a separate crate with an optional npm guest package, versioned outside the app. | A plugin is an external package, built and published outside this repository. | The repository never contains a plugin. |
| `tauri::Builder::plugin(init())` registers the plugin when the app is built. | The deployer places the package in the plugins directory or bakes it into the image. An admin reviews and enables it in the admin UI. Every client calls `registry.sync()` on load. | Registration is at deployment, then at runtime: no rebuild of Workspace. |
| Plugin `Builder::new("name")` with `setup`, `on_webview_ready`, `on_drop`. | The module's `initialize` and `render` hooks, and the `signal` the shell aborts on dispose. | The hooks are Anywidget's (GUEST-CONTRACT). |
| Commands (`#[command]`) called with `invoke("plugin:name\|cmd")`. | Host commands called with `experimental.invoke("core:ui:notify", msg)`. Plugin contributions (`exportOptions`, `exportData`, `copilotContext`) are called by the host. | Two directions, as in Tauri. |
| `permissions/*.toml`: `allow-x`, `deny-x`, permission sets, a default set. Commands are denied unless a permission exposes them. | The manifest lists the permissions each widget needs. `core:default` is the minimal set. Everything else is denied. | |
| Capability files bind permissions to windows. Several capabilities on one window combine. | Grants bind permissions to a widget instance: approved on the version (superuser), narrowed per entity (entity admin), limited to what the widget declares. | Window label corresponds to instance id. |
| Scopes (for example `fs` paths) attach to permissions and are injected into the command. | Scopes: the bound data source, the declared param names, byte and rate budgets. The authority injects them. | |
| Runtime authority checks origin, capability and scope before a command runs, and denies otherwise. | `RuntimeAuthority.check(instance, command, args)` runs in the host before any handler. The caller is identified by its message port, never by a field in the message. | |
| Isolation pattern: a sandboxed iframe hook inspects every IPC message and encrypts it with a key generated at startup. | Every plugin already runs in a sandboxed frame. The host validates each message against a schema, and the per-frame `MessagePort` is the secret. | |
| CSP is set in the app config by the app developer. The runtime appends nonces and hashes for its own code. | The plugin author declares the CSP in the manifest. The superuser approves or overrides it. The platform appends the shell's hash and enforces a floor. | The requirement: author-defined, admin-overridden. |
| Plugin code runs in the app's process. | Server-side plugin code, if any, runs in a separate restricted process (SERVER-SIDE). | A deliberate difference. |
| `plugins.<name>` in `tauri.conf.json` configures a plugin. | `entity_widget_plugin.settings`, validated against the manifest's `adminSettings` schema. | |
| Generated permission schemas. | A JSON Schema for the manifest, generated from the Zod source like `apps-schema.json`. | `frontend/scripts/generate-apps-schema.ts` is the model. |

Tauri's own documentation says capabilities do not protect against malicious or insecure plugin code, overly broad scopes, or supply-chain attacks. The same holds here. That is why the sandbox, the CSP, checksum pinning, process isolation and the admin's review exist in addition to the permission model.

## 3. Architecture

```
+-- Browser tab (Workspace origin) ----------------------------------------------------+
|                                                                                      |
|   Workspace SPA = the host                                                           |
|                                                                                      |
|    WidgetComponent --resolves--> PluginRegistry <--sync-- GET /app/widget-plugins    |
|         |                         (widget types, viz-type handlers, effective CSP)   |
|         v                                                                            |
|    PluginWidget   (inside DraggableCard: title bar, params, refresh, Copilot, ...)   |
|      - fetches the widget's data with the user's own credentials                     |
|      - pushes data / params / theme into the model, takes commands out               |
|         |                                                                            |
|         v                                                                            |
|    RuntimeAuthority:  command x instance permissions x scopes -> allow | deny+audit  |
|         ^                                                                            |
|         |   MessageChannel port, private to this one frame                           |
|   ======|================== sandbox boundary ========================================|
|         v                                                                            |
|    <iframe sandbox="allow-scripts" srcdoc=...>     opaque origin, no storage         |
|      shell   (effective CSP in a <meta> tag)         default: no network at all      |
|        1. canary self-test                 fails -> the host sends no code           |
|        2. receives the verified bundle     the host checked its SHA-256 first        |
|        3. import(blob:) -> AFM initialize() -> render({ model, el, signal })         |
|                                                                                      |
+--------------------------------------------------------------------------------------+
        |  only the host talks to the API; the frame has no path to the server
        v
+-- Workspace API ---------------------------------------------------------------------+
|   plugins dir (read-only, set by the deployer) | registry | RBAC | CSP policy        |
|   declarative proxies + secrets (credentials injected here) | audit                  |
+--------------------------------------------------------------------------------------+
        |  narrow, versioned RPC; call-context token; no path from the browser
        v
+-- Plugin backends (optional, separate processes) ------------------------------------+
|   one process or container per plugin; egress only to the hosts an admin approved    |
+--------------------------------------------------------------------------------------+
```

**Frontend** (new, under `frontend/src/plugins/`):

| Module | Job |
|---|---|
| `manifest.ts` | Zod schema and types for `plugin.json`; the source of the generated JSON Schema. |
| `csp.ts` | Parser and validator for the structured CSP and the server network list; the same rules run on the server. |
| `registry.ts` | Zustand store: plugins, widget types, viz-type handlers. Modelled on `useBackendConnectorStore`. |
| `authority.ts` | The runtime authority: effective permissions, scopes, budgets. |
| `protocol.ts` | Zod schemas for every message across the port. |
| `PluginFrame.tsx` | Creates the frame, runs the handshake and the canary, delivers the verified bundle, runs the watchdog. |
| `PluginWidget.tsx` | The widget component: `DraggableCard`, data fetch (`useJsonData`), params, Copilot data, export, states. |
| `shell/` | The shell: AFM host implementation that runs inside the frame. Built to a string the host inlines into `srcdoc`. |
| `api/plugins.api.ts`, `hooks/usePlugins.ts` | API client and React Query hooks, in the repo's existing naming. |

**Backend** (new, under `backend-api/backend/`):

| Module | Job |
|---|---|
| `api/models/plugin_models.py` | Tables of section 6.3. |
| `api/plugin_discovery.py` | Reads the plugins directory: verification, digests, manifest and CSP validation, states. |
| `api/plugin_proxy.py` | Declarative proxies and the outbound guard (SERVER-SIDE 3). Later phase. |
| `routers/plugins.py` | Superuser endpoints (`/plugins`). |
| `routers/admin.py` (additions) | Entity-admin endpoints (`/admin/plugins`, `/admin/role/{uuid}/plugin-access`). |
| `routers/app/widget_plugins.py` | User endpoints (`/app/widget-plugins`). |
| `scripts/plugin_check.py` | Offline checker for authors and deployers: the same validator, run on a directory (section 12). |
| `alembic/versions/<epoch>-add_widget_plugins.py` | The tables, in the style of `1785000100-add_role_copilot_access.py`. |

## 4. Packages, installation and lifecycle

### 4.1 How a plugin reaches a deployment

Only through the deployment, in one of three ways the deployer controls:

1. **A plugins directory.** `WIDGET_PLUGINS_DIR` names a directory on the API server. The deployer fills it: a volume, a mounted config map, files copied in by a pipeline.
2. **Baked into the deployment bundle.** The same directory inside the image the deployer builds.
3. **Admin-controlled configuration.** Settings that govern what the directory may contribute: checksum pins, the plugin backend registry, secret values (DESIGN 7.4, SERVER-SIDE).

There is no install button, no upload, no fetch from a URL and no endpoint that writes plugin files. The API reads the directory and never writes to it, so mount it read-only. Why this matters: with a web session able to install code, an XSS or a stolen admin session would be a way to deploy code to every user. Here the web app can only decide whether files someone else placed on the server may run.

### 4.2 Layout

```
<WIDGET_PLUGINS_DIR>/
  <plugin-id>/
    <version>/
      plugin.json        the manifest
      entry.js           one ES module: an Anywidget front-end module, all dependencies bundled
      entry.css          optional
      assets/            optional small files (icons, images, fonts) that the manifest names
      backend/           optional: plugin backend sources or build inputs; never served to browsers
```

Several versions can sit side by side, so an update can wait for approval while the active version keeps serving. The directory names must equal the manifest's `id` and `version`.

Why one frontend file: the module is delivered to a frame that, by default, has no network and cannot import anything. One file means one digest and code that cannot change after approval. Authors bundle with their usual tool and inline dynamic imports.

Only `entry`, `styles`, `assets/**` and the icon are ever served to a browser. Everything else, `backend/` included, is not.

### 4.3 Discovery and verification

The API scans the directory when a superuser asks for a rescan (the admin page's Rescan, or `POST /plugins/rescan`), not on its own at startup: API processes that start together would race over the same rows, and no integrity check depends on a scan, because every file is hashed again each time it is served (7.3) and a file that changed in place blocks its version at that request. For each version it:

1. Reads only paths that match the id and version patterns. Refuses symbolic links anywhere in the tree and anything that resolves outside the directory.
2. Applies the caps: `WIDGET_PLUGINS_MAX_FILES` and `WIDGET_PLUGINS_MAX_UNPACKED_BYTES`.
3. Parses `plugin.json` against the schema.
4. Hashes every file, computes the **version digest**, recomputes the manifest's `checksum` and compares both with the manifest and with any deployer pin.
5. Validates the manifest: permission ids, widget ids, `handles`, the CSP and the server network lists (the validator of SECURITY 4.3), proxy templates, secret and route references, `host.api`.
6. Warns, without blocking: remote imports in the entry (`import ... from "https://..."`, `import("https://...")`), because the frame cannot load them unless the CSP allows the origin; `eval` or `new Function` in the entry when `'unsafe-eval'` is not declared; a backend component not listed in `WIDGET_PLUGIN_BACKENDS`.
7. Records what it found. A version it has seen before whose digest changed is **blocked as changed**: versions are immutable, so the deployer publishes a new version. Directories that disappear are marked **missing**.

The **version digest** is the SHA-256 of the sorted lines `<path>`, NUL, `<file sha-256 in hex>`, newline, over every file in the version directory, `plugin.json` and `backend/` included, written `sha256-` followed by the hash in unpadded base64url (so it can stand in a URL path). It is the identity that approvals, pins and URLs bind to. The manifest's `checksum` covers the same listing without `plugin.json`, so a manifest can contain it. A deployer or an author gets both numbers from `python -m scripts.plugin_check --digest <dir>`.

**Checksum pinning in v1.** The author publishes `checksum`. The server recomputes it. The deployer may pin the expected version digest in `WIDGET_PLUGINS_PINS` (`"<id>@<version>": "sha256-..."`), and with `WIDGET_PLUGINS_REQUIRE_PINS=true` a version without a pin is blocked. The admin approves a specific digest, and the host re-checks every file's SHA-256 before it reaches a frame. Signing is a later phase (`signatures` is reserved in the manifest).

### 4.4 Manifest

```jsonc
{
  "manifestVersion": 1,
  "id": "<plugin-id>",                      // ^[a-z][a-z0-9-]{1,47}$; equals the directory name
  "version": "<major.minor.patch>",         // equals the directory name
  "name": "<display name>",
  "description": "<one sentence>",
  "publisher": { "name": "<publisher>", "url": "<https-url>" },   // shown to admins, never trusted
  "icon": "assets/icon.png",
  "host": { "api": 1, "afm": "0.11" },      // the runtime API version, and the Anywidget module revision the code follows
  "checksum": "sha256-<base64url>",         // of the files other than plugin.json; the server recomputes it
  "entry": { "module": "entry.js", "styles": ["entry.css"] },

  // What the admin reviews. Five families: host API permissions (per widget, below),
  // network (csp for the frame, server.network for the server side), secrets,
  // data sources, identity.

  // Network, frame. What the author asks the browser to allow. Omitted = nothing beyond the platform floor.
  // A request: it does nothing until a superuser approves it, and the admin can override it.
  "csp": {
    "connect-src": ["https://<host>"],
    "img-src": ["data:", "blob:", "https://<host>"],
    "script-src": ["'wasm-unsafe-eval'"]
  },
  "cspNotes": { "connect-src": "<why the plugin needs this host>" },   // shown to the admin at approval

  // Secrets: names and purposes only, never values (SERVER-SIDE 4).
  "secrets": [ { "name": "<secret-name>", "purpose": "<why>" } ],
  // Data sources: Workspace backends the server side may read for the calling user (SERVER-SIDE 5.7).
  "dataSources": [ { "id": "<name>", "purpose": "<why>" } ],
  // Identity: what a plugin backend learns about the user. none or pseudonymous.
  "identity": "none",

  // Server side (SERVER-SIDE). Omit both for a T0 plugin.
  "server": {
    "network": ["https://<host>"],
    "proxies": [],
    "backend": { "protocol": 1, "routes": [] }
  },

  // Admin-level settings of the plugin, validated against this schema. Non-secret.
  "adminSettings": { "schema": {}, "defaults": {} },

  "contributes": {
    "widgets": [
      {
        "id": "<widget-id>",                // ^[a-z][a-z0-9_-]{0,47}$
        "name": "<display name>",
        "description": "<one sentence>",
        "category": "<category>",
        "subCategory": "<sub category>",
        "handles": [                        // backend widget types this widget renders, e.g. table or chart
          {
            "type": "<viz-type>",
            "definition": {},               // closed JSON Schema for data.<viz-type> in a widgets.json entry (WIDGETS-JSON 3.3)
            "response": { "accepts": "json", "description": "<what the endpoint returns>", "schema": {} }
          }
        ],
        "standalone": false,                // true: also listed in Add widget
        "permissions": ["core:data:read", "core:params:write", "core:export:provide"],
        "server": { "proxies": [], "routes": [] },       // the proxies and backend routes this widget may call
        "model": {                          // how host state maps onto model traits (GUEST-CONTRACT 3)
          "traits": {
            "rows":   { "bind": "data" },
            "filter": { "bind": "param:filter", "access": "readwrite" }
          }
        },
        "params": [],                       // same ParamDef shape as widgets.json
        "settings": { "schema": {}, "defaults": {} },   // per-instance settings the user edits
        // No list of exports: with core:export:provide, the code's exportOptions decides
        // what it can export each time (GUEST-CONTRACT 5)
        "grid": { "w": 20, "h": 12, "minW": 8, "minH": 4 }
      }
    ]
  }
}
```

`contributes` leaves room for other contribution kinds later (toolbar actions, param controls, export formats). v1 knows only `widgets`.

| Field | Rule |
|---|---|
| `host.api` | The runtime API version the package targets. The host implements `1`. Any other value blocks the version, with that reason. |
| `host.afm` | The Anywidget module revision the code follows. The host implements `0.11`. Any other value blocks the version. |
| `checksum` | Required. A mismatch with the files blocks the version. |
| `csp`, `cspNotes` | `csp` is structured, never a raw string; rules in SECURITY 4. A declared policy is a request until a superuser approves it, and an admin override replaces it per directive. `cspNotes` carries one plain-text reason per directive for the trust summary. |
| `server.network` | The hosts proxies and a backend may contact: https origins, and for a backend `tcp://host:port` endpoints such as a database. Same host rules as CSP sources. Approved, overridden and narrowed the same way (SERVER-SIDE 6). |
| `secrets`, `dataSources`, `identity` | Requests the admin reviews. Values and credentials are never in the package. |
| `handles` | The viz types this widget renders. Each carries the closed `definition` of its `data.<type>` object in a `widgets.json` entry and the `response` the endpoint must return (WIDGETS-JSON 3.3). A built-in type (`markdown`, `html`, `iframe`, `newsfeed`, `pdf`) is rejected: built-ins are reserved. A `definition` that is not closed and bounded blocks the version. |
| `permissions` | A subset of the permission ids of GUEST-CONTRACT 4. Unknown ids are rejected. |
| `model.traits` | Optional. Without it the default trait names apply. |
| `params` | The existing `ParamDef` shape, so the existing param UI, grouping and linking apply. |
| `settings` / `adminSettings` | A small JSON Schema subset: object of string, number, integer, boolean and enum properties with `title`, `description`, `default`, `minimum`, `maximum`, `maxLength`. The host renders the form with the existing form components. `adminSettings` hold no secrets. |
| `signatures` | Reserved for signed packages (a later phase). |

### 4.5 Lifecycle and states

Defaults are closed: a discovered plugin does nothing until an admin acts.

```
deployer places files in the plugins directory (or the image)
        |
        v
discovered ----(invalid, digest mismatch, changed, unpinned in strict mode)----> blocked
        |
        |  superuser: review the trust summary, acknowledge, approve this version
        v
active   (enabled at the deployment, but available to nobody yet)
        |
        |  entity admin: enable for the entity; grant it to roles
        v
in use

a new version appears        -> "update available"; the active version keeps serving
superuser approves it        -> the new version becomes active; the entity scoping carries over
superuser revokes            -> revoked: nothing is served or called
deployer removes the files   -> missing: instances show the placeholder
```

Per version: `discovered`, `approved`, `active`, `blocked`, `retired`. Per plugin: `disabled` (the default), `enabled`, `revoked`.

## 5. Registration in the host

**Registry.** `usePluginRegistryStore` holds `plugins`, `widgetTypes` and `vizHandlers`. It is fed by `GET /app/widget-plugins` (React Query) on sign-in, on window focus and every 60 seconds while visible, using the response's `etag`. Plugins the user may not use are not in the response. Removing a plugin from the response unregisters its types and tears down its running frames. Instances stay in their dashboards.

**Resolution order.** `WidgetComponent` (`frontend/src/components/Widget.tsx`) resolves a widget in this order. Steps 1, 3 and 4 exist today; 2 and 5 are new.

1. The file-extension special case.
2. `widget.plugin` is set: the plugin registry.
3. A built-in by clean widget id (`getWidgetComponent`).
4. A built-in by `type`.
5. `registry.resolveVizHandler(type)`: a plugin that handles this viz type.
6. The unavailable placeholder.

**The viz-type gate.** Today the set of viz types is closed: `isWidgetVizType(type)` has four callers and `widgetTypesSchema` has two users. Backend widgets of other types are left out of the catalog with a warning (`partitionSupportedWidgets`, `validateBackend.ts:120`, the message at `:648`). That is exactly where plugins plug in:

| Call site | Change |
|---|---|
| `frontend/src/lib/types/app.ts` (`WidgetVizTypes`, `widgetTypesSchema`, `isWidgetVizType`), and `utils/zodForms.ts:107`, which uses the schema | Split into `isBuiltInVizType` and `isRenderableVizType(type, extraTypes)`. `widgetTypesSchema` accepts any well-formed type name (`^[a-z][a-z0-9_-]{1,31}$`), because validation runs before the registry is loaded. Whether a type renders is decided by `isRenderableVizType`, not by the schema. |
| `frontend/src/lib/utils/validateBackend.ts` (`partitionSupportedWidgets`, the warning text) | Validates against the composed `widgets.json` schema and takes its type list from it (WIDGETS-JSON 3.6). The warning names the types no enabled plugin handles, and for admins which discovered plugin would. |
| `frontend/src/apiSource.worker.ts` | The worker has no access to the registry store. The main thread passes the composed schema in the worker message. |
| `frontend/src/lib/utils/app.ts:1522`, `components/DataConnectors/common/helpers.ts:257`, `lib/contexts/MyDataConnectorsContext.tsx:99` | Use `isRenderableVizType`. |

`extraTypes` is the set of viz types handled by plugins that are **available to this user** (section 6.4). It is the plugin part of the composed schema's `x-types` (WIDGETS-JSON 3.4). A backend widget of a type the user has no renderer for is treated as unsupported for that user.

**Handler conflicts.** Two plugins may both declare `handles: ["table"]`. The entity admin picks the handler per viz type and entity (`entity_viz_handler`, unique on `(entity, viz_type)`). With no choice, or a choice the user may not use, the lowest plugin id handles the type. There is no deployment-wide default. The admin UI shows the winner.

**Standalone widgets.** A widget with `standalone: true` is listed in Add widget through a new connection type `plugin` (`ConnectionTypes` at `frontend/src/lib/state/backendConnector.ts:87`), added to `getAllWidgets` (`frontend/src/lib/utils/widget.ts:183`). Its instance JSON carries `plugin: { id, widget }`; `widgetId` is `plugin:<id>:<widget>` for search keys. v1 standalone widgets are config-driven (a clock, a static chart from settings) or use a declared proxy. Binding a standalone widget to a source widget is a later feature.

As built: `standalonePluginWidgets` (`plugins/registry.ts`) turns the standalone widgets of the plugins available to the user into catalog entries, which `useGetAppWidgets` puts with the Workspace's own widgets. That catalog is what Add widget and the agent read; `getAllWidgets` is not used for this. An entry has the plugin's name as its source, its category (or the plugin's name), the manifest's `params` and `grid` (as `gridData`), `type: "custom"` and the `plugin` reference. Add widget lists it under "All". The `plugin` reference is kept when the widget is added (`getWidgetData`, `InternalWidgetSchema`), and `WidgetComponent` renders it through `PluginWidget`. Checked in Playwright: a standalone widget of the test package is added from the menu, renders from its settings' defaults, and is still there after a reload.

**Hazard to fix first.** `getCleanWidgetId` (`widget.ts:261`) rewrites ids with unanchored regexes (`/file-.*/`, `/iframe-.*/`, `/html-.*/`). Any id that merely contains one of those substrings is mangled. Backend widgets are exempt through `connectionType === "advanced-backend"`. The new `plugin` connection type gets the same exemption, the regexes get anchored with `^`, and `WidgetComponent` dispatches on `widget.plugin` before it cleans anything.

**Persisted instance JSON.** The dashboard stores `type`, `widgetId`, the `plugin` reference, the usual `endpoint` and `params` for backend-bound widgets, and `storage.plugin = { state, config }` (`WidgetStorage` already has an index signature). A dashboard never stores plugin code or the manifest. `state` is at most 64 KiB, `config` at most 32 KiB. The plugin owns `state`; the host never interprets it.

**Unavailable states.** An instance whose type cannot render shows a placeholder and keeps its JSON, so restoring the plugin brings it back.

| State | User sees | Admin additionally sees |
|---|---|---|
| Not discovered, missing, revoked, not enabled for the entity, no role grant | "This widget type is not available to you." | The reason and a link to `/admin/widgets`. |
| Update pending | The active version keeps running. | A badge and the diff. |
| Sandbox check failed | "Plugin sandbox unavailable." | Which check failed, for example "the frame's CSP was not applied". |
| Bundle fetch failed or digest mismatch | "Failed to load." with retry. | The digest that was expected. |
| Frame unresponsive | "Not responding." with retry. | Counted in the plugin's health. |
| `initialize` or `render` threw | "Plugin error." | The reported message, as text. |

## 6. RBAC and who may do what

### 6.1 What exists

- Two admin tiers. **Superuser**: `get_current_superuser`, the `entity` router, `useIsEntityAdmin` in the SPA, and the admin CLI inside the API container (`scripts/workspace_admin.py`). The seeded administrator is a superuser (`scripts/init_users.py`). **Entity admin**: `get_current_admin`, a user whose permissions map is named `Admin`, used by `/admin/*` (users, roles, activity log). The seeded administrator has both.
- Role grants are tables keyed by role: `RoleBackend`, `RoleFile`, `RolePrompt`, `RoleCopilotModel`, `RoleMcpAccess` (`api/models/entity_models.py`). The newest two, and their dialog `RoleCopilotAccessDialog`, are the template. Their rule: what a user may use is the union of what their roles grant, and a kind no role grants is not available.
- `AuditEntityRolesPermissions` plus the listeners in `api/events/role_permission_events.py` feed the activity log (`/admin/role-permissions-audit-logs`).
- A user's entity is `get_entity_uuid(db, user_uuid)` (`routers/app/helpers.py:381`).

### 6.2 Who does what

| Action | Deployer | Superuser | Entity admin | Role members | Anyone else |
|---|---|---|---|---|---|
| Put a plugin on the server, bake it in, pin its checksum, register a backend | yes (outside the app) | no | no | no | no |
| Rescan; review the trust summary; approve a version (enable at the deployment) | no | yes | no | no | no |
| Approve or override the CSP and the server network lists, in either direction | no | yes | no | no | no |
| Set a secret value | via configuration | yes (write-only) | no | no | no |
| Revoke, restore, forget a missing plugin | no | yes | no | no | no |
| Enable for an entity (bulk helper for all entities) | no | yes | own entity | no | no |
| Plugin admin settings; choose viz-type handlers | no | yes | own entity | no | no |
| Narrow permissions, CSP or server network for the entity (remove only) | no | yes | own entity | no | no |
| Grant widget types to roles | no | no | own entity | no | no |
| Use an available widget type | n/a | n/a | yes | yes | no |

On a single-organization deployment the seeded administrator is both superuser and `Admin`, so the admin does the whole flow in one session. A deployment with several entities separates the people who run the deployment from the entity admins.

### 6.3 Data model

Style follows the existing models (`Base`, `UUIDMixin`, `DateMixin`, `JSONType`, `GzipJsonType` and `EncryptedType` from `model_helpers`). Package files stay on disk; the database holds decisions and what discovery found.

```python
class WidgetPlugin(Base, UUIDMixin, DateMixin):            # table widget_plugin
    plugin_id: str                    # String(48), unique
    name: str
    status: str                       # "disabled" (default), "enabled", "revoked": the platform kill switch
    active_version_uuid: UUID | None  # FK widget_plugin_version.uuid (use_alter)
    overrides: dict | None            # superuser overrides: {"csp": {directive: [sources]}, "server_network": [hosts]}

class WidgetPluginVersion(Base, UUIDMixin, DateMixin):     # table widget_plugin_version
    plugin_uuid: UUID                 # FK, CASCADE
    version: str                      # unique with plugin_uuid
    digest: str                       # the version digest, unique
    declared_checksum: str            # the manifest's checksum
    pin_status: str                   # pinned, unpinned, mismatch
    manifest: dict                    # GzipJsonType
    files: dict                       # JSONType: served path -> {size, sha256, mime}
    path: str                         # relative to WIDGET_PLUGINS_DIR
    state: str                        # discovered, approved, active, blocked, retired, missing
    blocked_reason: str | None
    discovered_at: datetime
    approved: dict | None             # what the superuser accepted for THIS version: permissions, csp, server_network,
                                      # secrets, data_sources, identity, confirmations
    approved_by_uuid: UUID | None
    approved_at: datetime | None

class EntityWidgetPlugin(Base, UUIDMixin, DateMixin):      # table entity_widget_plugin
    entity_uuid: UUID                 # FK entity, CASCADE
    plugin_uuid: UUID                 # FK widget_plugin, CASCADE
    enabled: bool                     # default false
    settings: dict                    # validated against the manifest's adminSettings
    narrowed_permissions: list[str]   # removed for this entity
    csp_narrow: dict | None           # directive -> the only sources this entity allows
    server_network_narrow: list[str] | None
    # unique (entity_uuid, plugin_uuid)

class EntityVizHandler(Base, UUIDMixin, DateMixin):        # table entity_viz_handler
    entity_uuid: UUID; viz_type: str; plugin_uuid: UUID; widget_id: str
    # unique (entity_uuid, viz_type)

class RoleWidgetPlugin(Base, UUIDMixin, DateMixin):        # table role_widget_plugin
    role_uuid: UUID                   # FK role, CASCADE
    plugin_uuid: UUID                 # FK widget_plugin, CASCADE
    widget_id: str                    # "*" or a widget id; default "*"
    # unique (role_uuid, plugin_uuid, widget_id), like role_mcp_access

class WidgetPluginSecret(Base, UUIDMixin, DateMixin):      # table widget_plugin_secret (SERVER-SIDE 4)
    plugin_uuid: UUID; name: str; value: dict  # EncryptedType("widget_plugin_secret.value"); never returned by any endpoint
    set_by_uuid: UUID                          # unique (plugin_uuid, name)

class WidgetPluginEvent(Base, UUIDMixin, DateMixin):       # table widget_plugin_event (platform and entity events)
    plugin_uuid: UUID; version_uuid: UUID | None; entity_uuid: UUID | None
    actor_uuid: UUID | None; action: str; details: dict

class WidgetPluginCspReport(Base, UUIDMixin, DateMixin):   # table widget_plugin_csp_report
    plugin_uuid: UUID; version_uuid: UUID; entity_uuid: UUID
    directive: str; blocked_origin: str; count: int; first_seen; last_seen
    # unique (plugin_uuid, entity_uuid, directive, blocked_origin); 30 day retention
```

### 6.4 Availability

The server computes what a user may use. The SPA never decides.

```
available(user, plugin, widget) =
      plugin.status == "enabled"
  and plugin.active_version.state == "active"
  and entity_widget_plugin(entity(user), plugin).enabled
  and exists role in roles(user): role_widget_plugin(role, plugin, widget or "*")

effective_permissions = approved.permissions
                        ∩ widget.permissions
                        − entity_widget_plugin.narrowed_permissions

effective_csp         = compose(floor, approved_policy(plugin_version), entity.csp_narrow)    # SECURITY 4
effective_server_net  = approved.server_network − entity.server_network_narrow              # SERVER-SIDE 6
```

A backend widget rendered by a viz handler is gated twice and independently: by the existing backend and role rules for the widget itself, and by this rule for its renderer.

### 6.5 Default access

Everything starts closed. A discovered plugin is disabled. An approved plugin is enabled at the deployment but enabled for no entity. A widget type is available to users only through an explicit grant: a role that grants it. Admins are no exception: an admin uses a plugin through a role that grants it, like everyone else. This is the rule of every role grant (6.1). The role dialog says so in its text.

### 6.6 Sharing

- A shared dashboard with a plugin widget shows the placeholder to a viewer without access. Sharing a dashboard never shares a plugin.
- Data is fetched with the viewer's own access, as for every widget.

### 6.7 Audit

- Role grants reuse `AuditEntityRolesPermissions`: add `RoleResourceType.WIDGET_PLUGIN` (`api/events/types.py`) and listeners for `RoleWidgetPlugin` next to the `RoleBackend` ones. They then appear in the existing activity log page.
- Platform and entity actions (rescan results, new version found, block, approve with the acknowledgement and confirmations, revoke, override, enable, narrow, secret set or cleared, forget) go to `widget_plugin_event`, because the existing audit table requires a role and an entity. The plugin page shows them.

## 7. Backend API

### 7.1 Endpoints

New routers carry the tag `widget-plugins`, so `SUPPRESSED_API_ROUTERS` (`main.py:include_routers`) can switch them off like any router. The `/app` router already requires the deployment's service token (`check_origin`) in addition to the user session. **No endpoint writes plugin files.**

| Method and path | Auth | Purpose |
|---|---|---|
| `POST /plugins/rescan` | superuser | Re-read the plugins directory. Returns what changed. |
| `GET /plugins`, `GET /plugins/{plugin_id}` | superuser | Discovered plugins and versions with states, pin status and digests. Detail: the trust summary data, the diff against the active version, events. |
| `POST /plugins/{plugin_id}/versions/{version}/approve` | superuser | Approve this version and make it active. Body: the acknowledgement, the permissions, CSP, server network, secrets, data sources and identity accepted, and the typed confirmations for dangerous items. |
| `PUT /plugins/{plugin_id}/overrides` | superuser | Set or clear the CSP and server network overrides. |
| `PUT` and `DELETE /plugins/{plugin_id}/secrets/{name}` | superuser | Set (write-only) or clear a secret value. |
| `GET /plugins/{plugin_id}/csp-reports` | superuser | Aggregated blocked requests. |
| `POST /plugins/{plugin_id}/revoke`, `.../restore` | superuser | Kill switch. |
| `PUT /plugins/{plugin_id}/entities/{entity_uuid}` | superuser | Enable or disable for an entity; a bulk form for all entities. |
| `DELETE /plugins/{plugin_id}` | superuser | Forget a plugin whose files are gone: decisions, secrets and grants. |
| `GET /admin/plugins` | entity admin | Plugins as this entity sees them. |
| `PUT /admin/plugins/{plugin_id}` | entity admin | Enable, admin settings, narrowing (permissions, CSP, server network), viz handlers. |
| `GET /admin/plugins/{plugin_id}/csp-reports` | entity admin | Blocked requests of this entity. |
| `GET` and `PUT /admin/role/{role_uuid}/plugin-access` | entity admin | Role grants, mirroring `.../copilot-access`. |
| `GET /app/widget-plugins` | signed-in user | `{ enabled, etag, plugins }`: what this user may use, with widgets, params, settings schemas, data contracts, effective permissions, effective CSP string, digests. `enabled: false` when the feature is off. |
| `GET /app/widget-plugins/{plugin_id}/{digest}/files/{path}` | signed-in user with availability | The raw bytes of one served file. `Cache-Control: private, max-age=31536000, immutable`, `ETag` is the file digest. |
| `POST /app/widget-plugins/{plugin_id}/proxy/{proxy_id}` | signed-in user with availability | A declared proxy call (SERVER-SIDE 3). Body: `{ widget, args }`; answers `{ content_type, body }`. |
| `POST /app/widget-plugins/{plugin_id}/backend/{route_id}` | signed-in user with availability | A plugin backend call (SERVER-SIDE 5). Body: `{ widget, instance, args }`; answers `{ body }`. |
| `POST /app/widget-plugins/report` | signed-in user | Frame failures and blocked requests, rate limited, no widget data. |
| `POST /internal/plugin-broker/data/{id}` | plugin backend, with a call-context token and an allowed `Origin` | Data for the calling user (SERVER-SIDE 5.7). |
| `POST /plugins/{plugin_id}/backend/check` | superuser | Ask the plugin's backend for its identity now (SERVER-SIDE 5.5). |

### 7.2 Discovery pipeline

Section 4.3 is the pipeline. After it, the API holds, per version, a state and a list of findings that the trust summary shows. A rescan never changes the active version, and never changes any state toward "more trusted": it can only add `discovered` versions or move versions to `blocked` or `missing`.

### 7.3 File delivery

- The file endpoint reads from the plugins directory after the availability check. The requested path must be in the version's served-file index. It is normalized and resolved, and must stay inside the version directory without crossing a symbolic link.
- The API never serves plugin code as a document. The endpoint answers `application/octet-stream` with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`, like user uploads (`FileStream` in `api/storage/local.py` already sets `attachment`). Only the host reads the bytes.
- The server hashes a file when it is first read and whenever its size or modification time changes. A file that no longer matches its recorded digest is refused and the version is blocked as changed.
- The host fetches `entry.js`, styles and named assets with its credentials, verifies each SHA-256 against the digest in the plugin listing, and sends the bytes into the frame. Replicas must see the same directory; the digest in every URL makes a mismatch visible instead of silent.

### 7.4 Configuration

Settings in `utilities/config.py`, documented in `envs/.env.example` and the README table. The switch is `WIDGET_PLUGINS_DIR`: unset, the feature is off and the SPA learns that from `GET /app/widget-plugins`. The web container needs no new variable, and `render-frontend-config.sh` does not change.

| Setting | Default | Meaning |
|---|---|---|
| `WIDGET_PLUGINS_DIR` | unset | The plugins directory. Unset: feature off. Mount it read-only. |
| `WIDGET_PLUGINS_PINS` | empty | A JSON map `"<id>@<version>": "sha256-<digest>"`. A discovered version whose digest differs is blocked. |
| `WIDGET_PLUGINS_REQUIRE_PINS` | `false` | When true, a version without a pin is blocked. Recommended for production. |
| `WIDGET_PLUGINS_MAX_UNPACKED_BYTES` | 67108864 | Cap per version. |
| `WIDGET_PLUGINS_MAX_FILES` | 200 | Cap per version. |
| `WIDGET_PLUGIN_BACKENDS` | empty | The plugin backend registry, `{"<plugin id>": "<internal URL>"}` (SERVER-SIDE 5.5). |
| `WIDGET_PLUGIN_BACKEND_MAX_BYTES`, `WIDGET_PLUGIN_BACKEND_TIMEOUT_MS` | 5242880, 30000 | Caps on every backend call. |
| `WIDGET_PLUGIN_BACKEND_CONCURRENCY`, `WIDGET_PLUGIN_BACKEND_RATE_PER_USER`, `WIDGET_PLUGIN_BACKEND_RATE_PER_PLUGIN` | 8, `60/minute`, `600/minute` | Backend call limits. |
| `WIDGET_PLUGIN_BACKEND_BREAKER_FAILURES`, `WIDGET_PLUGIN_BACKEND_BREAKER_SECONDS` | 5, 30 | The circuit breaker. |
| `WIDGET_PLUGIN_BACKEND_IDENTITY_SECONDS` | 60 | How long an identity check holds. |
| `WIDGET_PLUGIN_SECRETS_DIR` | unset | Secret values set by configuration, one file per secret at `<dir>/<plugin id>/<name>` (SERVER-SIDE 4, decision S2). Wins over a value a superuser set. |
| `WIDGET_PLUGIN_PROXY_MAX_BYTES`, `WIDGET_PLUGIN_PROXY_TIMEOUT_MS` | 5242880, 30000 | Caps on every proxy call, whatever a manifest declares. |
| `WIDGET_PLUGIN_PROXY_CONCURRENCY` | 8 | Calls of one plugin running at once, per API process. |
| `WIDGET_PLUGIN_PROXY_RATE_PER_USER`, `WIDGET_PLUGIN_PROXY_RATE_PER_PLUGIN` | `60/minute`, `600/minute` | Proxy call rate limits. |
| `WIDGET_PLUGIN_PROXY_CA_FILE` | unset | A certificate authority the proxies trust besides the system's. |

A locked mode, where enablement comes only from deployment configuration and the admin UI is read-only (the precedent is Grafana's `plugin_admin_enabled` and WordPress's `DISALLOW_FILE_MODS`), is a later option.

### 7.5 Database revision and tests

One Alembic revision creates the tables of 6.3 (explicit `op.create_table`, `batch_alter_table` indexes, a `downgrade` that drops them). Tests in PLAN section 3.

## 8. Admin UIs

All three surfaces call the same endpoints.

### 8.1 In the Workspace: `/admin/widgets`

New route `frontend/src/routes/admin/widgets.tsx` and a `SidebarNavButton` in `LayoutAdmin/AdminSidebar.tsx`, shown when `GET /app/widget-plugins` says `enabled`. React Query hooks in `hooks/useAdminPlugins.ts`, API in `api/plugins.api.ts`. The table uses `ds/molecules/DataTable` and `RenderNoData`. The page has two tabs that never mix:

- **Core widgets.** The built-ins, read-only: name and what it does.
- **Plugin widgets.** Managed here. A banner states that plugins are installed by whoever deploys Workspace and that this page reviews and enables them; there is no install or upload control anywhere.

The plugin list shows: name and id, active version, status (Not enabled (the default), Enabled, Update available, Blocked, Missing, Revoked), the role grants, and small markers for what it asks for (frame network, server network, secrets, data sources, server-side code).

### 8.2 The trust summary

The first thing in a plugin's drawer, and the screen an admin must pass before anything is enabled. Security responsibility rests with the admin, so the screen exists to make that responsibility easy to exercise.

1. **What it is.** Name, id, version, publisher as claimed (unverified), description.
2. **Integrity.** The manifest's checksum and whether the server's recomputation matches; the version digest; the deployer's pin (pinned, not pinned, mismatch); file names and sizes; warnings from discovery.
3. **What it asks for**, in plain language, one card per family:
   - Host API: "reads the data of its widgets", "changes widget parameters", "saves its own state", "provides data to the Copilot", "exports data".
   - Frame network: "the widget can contact `<hosts>`, and can send the data it displays there", or "no network access".
   - Server network: the hosts its proxies or backend can contact.
   - Secrets: each name and purpose. The value is never shown.
   - Data sources: the Workspace backends it may read for the user.
   - Identity: "learns an anonymous per-plugin user id" or nothing.
   - Server-side code: "runs code on the server, in a separate process" or "none"; the tier.
4. **What it provides.** Widget types, with the data contract of each and the viz types it handles.
5. **Changes since the active version**, for an update: items added or removed in each family, widgets added or removed, and "code changed". Changed requests are highlighted and each needs its own acknowledgement.
6. **Responsibility.** "You are deciding to trust this plugin. Workspace limits what it can reach and tells you what it asks for. It does not make the plugin safe." An acknowledgement, and a typed confirmation for critical items (a remote script origin, an insecure or private host).

### 8.3 Enabling

A three-step flow from the trust summary: review and acknowledge, approve (this version, at the deployment), enable it for an entity. A superuser does the first two; an entity admin enables it for the entity, or a superuser for any entity or all of them. Then the entity admin grants its widget types to roles (8.4): nobody may use it until a role does.

Further tabs of the drawer: **Network and CSP** (declared by the author, admin override, effective; reset to the author's; the egress summary; the **Blocked requests** feed with an Allow action, SECURITY 4.7), **Access** (the role grants per widget type, viz-type handlers), **Settings**, **Versions** (history, approve a version, diff), **Activity**.

### 8.4 Roles

`RolesPage.tsx` gets a "Widget plugins" action next to "Copilot access", opening `RolePluginAccessDialog.tsx` (a sibling of `RoleCopilotAccessDialog.tsx`): the plugins enabled for the entity with a checkbox per widget type and "all widget types". The text states the rule: widget types are available only to roles that grant them. Backend: `GET` and `PUT /admin/role/{role_uuid}/plugin-access`.

### 8.5 Entities (superuser)

The entity edit dialogs (`components/AdminEntities/`) get a read-only "Plugins" line, and the plugin page gets an "Enabled for" table with a toggle per entity and "enable for all".

As built: `EntityPluginsLine` in the edit dialog's Base tab names the plugins enabled for the entity, from the `enabled_for` list of `GET /plugins`, with a link to the Widgets page.

### 8.6 CLI

`scripts/workspace_admin.py`, the admin CLI that runs inside the API container on the database (`docker compose exec api python -m scripts.workspace_admin plugin ...`, `docker exec workspace workspace-admin plugin ...` in Lite), has `plugin list`, `plugin rescan`, `plugin show <id>`, `plugin approve <id> <version> [--digest <d>] --acknowledge` (without `--acknowledge` it prints the review and approves nothing; `--digest` stops when the server's files are not the ones checked), `plugin revoke` and `restore <id>`, `plugin enable` and `disable <id> (--entity <uuid> | --all)`, `plugin grant` and `ungrant <id> --role <uuid> [--widget w]`, `plugin override <id> (--csp-file <json> | --server-network <origin> ... | --clear) [--confirm ...]`, `plugin secret set` and `clear <id> <name>` (the value is read from a prompt that does not echo, or from standard input, never from an argument), `plugin check-backend <id>`, `plugin events`, `plugin reports` and `plugin forget <id>`. It does what the superuser's routes do, with the service functions they call, for every entity; its decisions record no user. Entities and roles are named by UUID, as in the CLI's other commands. There is no `install`. Checking a package offline is `python -m scripts.plugin_check <dir>` (section 12).

## 9. What users see

- **Add widget** lists standalone plugin widgets under their category, marked as provided by the plugin. Backend widgets of a viz type a plugin handles appear in the catalog as before.
- **Chrome.** Plugin widgets render inside `DraggableCard`: title, refresh, params (the existing param bar and param groups), Copilot context, fullscreen, settings (a form generated from the manifest's `settings` schema). Loading, error and "last updated" states come from the host, so a plugin widget behaves like the built-ins, with one difference: the frame stays mounted under them (hidden, not removed), because the frame is the plugin's whole realm and removing it restarts the plugin and drops its pending calls. The frame's color scheme follows the Workspace theme in place, without a reload (the browser paints a frame opaque when its scheme differs from the page's). The info popover names the plugin and its version.
- **Data.** The host fetches with `useJsonData`, as the built-in widgets do (endpoint, headers, params, `staleTime`, `runButton`, refresh), builds the request from the widget's `method` and each param's `in` (WIDGETS-JSON 4), applies `data.dataKey` with lodash `get` as `Markdown.tsx:187` and `News.tsx:68` do, and pushes the result into the model's `data` trait. `RenderIfVisible` defers frame creation until the widget is near the viewport; it defaults to `stayRendered`, so plugin widgets pass `stayRendered=false` and release the frame when scrolled far away or when their dashboard tab is not active.
- **Copilot.** The fetched data goes to the Copilot through `useCopilotDataWidget` as for built-in widgets. A plugin with `core:copilot:context` can supply a refined view (filtered or sorted rows) through its `copilotContext` export.
- **Export** is the plugin's own (GUEST-CONTRACT 5). With `core:export:provide`, the card's Export entry asks the plugin's `exportOptions()` what it can export now, shows those options in the Workspace's export dialog, and saves what `exportData(id, { title })` returns, with the extension and type the option names. The host assumes no format, and has no fallback: the card's picture of its DOM cannot see into the sandboxed frame, so a plugin without the two functions has no Export entry.
- **Theme.** The host sets the `theme` trait: mode, a fixed set of design tokens, locale, decimals.
- **Links, clipboard, downloads** go through host commands. Links use the existing external-link confirmation.

## 10. Versions, updates, removal

- Every version in the directory is immutable. One version per plugin is active, globally. The deployer adds a version by placing a new directory; nothing else.
- **A new version never takes effect on its own.** It appears as "update available" and the active version keeps serving. Activating it is an explicit superuser action, with the diff of section 8.2. An update that changes only code still needs the action; there is no silent update, and no auto-update setting. Entity scoping and role grants carry over once the new version is activated, not before.
- An admin can approve any version that is in the directory, newer or older.
- **Revoke** sets `status = revoked`: the next sync removes the plugin, running frames are torn down within about a minute (the sync interval), proxies and backends stop being called at once, instances show the placeholder.
- **Removal** is the deployer deleting the files. The plugin shows as missing and instances show "no longer installed". A superuser may then forget it, which deletes the decisions, grants and secrets. The host cannot know which dashboards reference a plugin (dashboards are compressed JSON).

## 11. Audit and observability

- Audit: section 6.7. Approvals record the acknowledgement and every typed confirmation. Overrides record before and after.
- Metrics (the API already exposes Prometheus through `instrumentator`): discoveries, blocks by reason, approvals, file fetches, proxy and backend calls and their status classes, report counts per directive, frame failure reports per plugin and version.
- The report endpoint takes failure kind, plugin id and version, the blocked directive and the blocked origin only. It never takes widget data or paths. Origins are attacker-controlled strings: size-capped, de-duplicated, capped in number per plugin, and rendered as text.

As built (`backend-api/backend/api/widget_plugins/metrics.py`, on `/metrics` when `PROMETHEUS` is on): `widget_plugin_discoveries_total{outcome}`, `widget_plugin_blocks_total{reason}` (files, manifest, checksum, pin, changed; discovery records the reason of the first blocking finding), `widget_plugin_approvals_total`, `widget_plugin_file_fetches_total{outcome}` (served, refused, changed), `widget_plugin_proxy_calls_total{plugin, outcome, status_class}` and `widget_plugin_proxy_call_seconds{plugin}`, `widget_plugin_csp_reports_total{directive}`, and `widget_plugin_frame_failures_total{plugin, version, kind}`. A frame that ends reports its kind (`sandbox-failed`, `integrity-failed`, `load-failed`, `plugin-error`, `unresponsive`, `ended`), never its detail. Plugin and version labels are counted only for a plugin the caller may use, so a client cannot add labels.

## 12. Developing a plugin

There is no developer mode, no "load unpacked plugin" and no way for a user to try a plugin on someone else's deployment. A developer runs their own copy of the open-source Workspace and is the admin of that instance:

1. Start the local stack (`local/`, see its `LOCAL_SETUP.md`) and mount a plugins directory into the API container, read-only, with `WIDGET_PLUGINS_DIR` pointing at it.
2. Build the plugin into `<dir>/<id>/<version>/`.
3. Run `python -m scripts.plugin_check <dir>` (the server's own validator, offline). `--digest` prints the checksum and the version digest.
4. Sign in as the administrator, rescan, review the trust summary, approve, enable for the entity and grant the widget type to a role.
5. Iterate by publishing a new version directory and approving it. The same rules apply to a developer's instance as to any deployment.

The authoring reference for the module contract is GUEST-CONTRACT 7.

## 13. References

Tauri v2: [capabilities](https://v2.tauri.app/security/capabilities/), [runtime authority](https://v2.tauri.app/security/runtime-authority/), [isolation pattern](https://v2.tauri.app/concept/inter-process-communication/isolation/), [plugins](https://v2.tauri.app/develop/plugins/), [CSP](https://v2.tauri.app/security/csp/).

Anywidget: [AFM specification](https://anywidget.dev/en/afm/), [getting started](https://anywidget.dev/en/getting-started/), and the sources read on 2026-10-09 in [manzt/anywidget](https://github.com/manzt/anywidget): `packages/types/index.ts`, `packages/anywidget/src/{load,runtime,host,invoke,model-proxy}.ts`.

Browsers and CSP: MDN [CSP `sandbox`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/sandbox); Chalmers, [Data Exfiltration in the Face of CSP](https://research.chalmers.se/en/publication/?id=237715).

Precedents named by the team: Grafana ([backend plugins run as separate processes](https://grafana.com/developers/plugin-tools/key-concepts/backend-plugins/); [authentication for data source plugins](https://grafana.com/developers/plugin-tools/how-to-guides/data-source-plugins/add-authentication-for-data-source-plugins), where saved secrets are reachable only through the server proxy or a backend component; [`plugin_admin_enabled`](https://grafana.com/docs/grafana/next/plugins/); the [frontend sandbox](https://grafana.com/docs/grafana/latest/administration/plugin-management/plugin-frontend-sandbox/), a preview that proxies the DOM in-page), Looker ([manifest entitlements](https://docs.cloud.google.com/looker/docs/reference/param-manifest-application): external API URLs, OAuth URLs, user attributes), WordPress (`DISALLOW_FILE_MODS` locks installs from the admin), Shopify ([remote rendering](https://shopify.engineering/remote-rendering-ui-extensibility)), Backstage, FDC3 and OpenFin.
