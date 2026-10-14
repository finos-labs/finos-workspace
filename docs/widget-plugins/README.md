# Widget plugins

Status: design 2026-10-09; implementation in progress on `feature/widget-plugins` since 2026-10-12. The decisions D1 to D11 below are taken as recommended.

**Built** (frontend, backend, tests):

- The host runtime: the shell (AFM host side, canary, budgets, violation reports), `PluginFrame`, `PluginWidget`, the registry, the authority (permissions, scopes, rate limits), effective CSP composition and narrowing, bundle verification, the theme trait, and `core:asset:read`, which gives a module a file of its package's `assets/` (a WebAssembly binary, a worker, a font), checked like the module.
- Discovery and verification (digests, checksums, pins, caps, symbolic links, changed versions), the approve flow with acknowledgement and typed confirmations, availability (entity enablement, everyone or roles, bundle exclusion, revocation), effective permissions, file delivery that re-hashes every file, audit events, CSP reports with retention, `scripts/plugin_check.py`.
- The admin UIs: the Widgets page (deployment tab for superusers with the trust summary, the organizations a plugin is enabled for, overrides, secrets and activity; entity tab for entity admins), the role access dialog, the entity dialogs' read-only Plugins line, plugin grants in the activity log (as "widget plugin", with a message naming the plugin and widget), the operator panel's Plugins tab, and `workspace-admin plugin ...`.
- Operator docs: `envs/.env.example`, the commented mounts in `docker-compose.yml` and `local/compose.yaml`, `local/LOCAL_SETUP.md` (Widget plugins), the CLI README.
- The integration: the viz-type gate open to registry types, the worker given the plugin types, plugin widgets in the catalog.
- The endpoint probe: one plain `OPTIONS` per route (WIDGETS-JSON 4.8).
- The closed `widgets.json` contract: the Zod contract, the generated kit, the per-entity composed schema served with an `ETag`, validation with `ajv` in the SPA and the checks JSON Schema cannot state (WIDGETS-JSON 3.1 to 3.7), and the closed `data_args` and `ui_args` schemas that `get_widget_schema` returns and the widget tools enforce (3.8). The app-builder spec pages' lists are generated from the contract, and `workspace://specs/widgets-json-schema` serves the user's schema (3.9). An app's `plugin.config` for a plugin widget is checked against the plugin's settings (3.10).
- Request mapping: `method`, `in` and `optionsMethod`, and one request builder for widgets, option lookups, forms, the Copilot and the Excel export (WIDGETS-JSON 4.10).
- Standalone plugin widgets in Add widget, added with their plugin reference (DESIGN 5).
- The MCP tool opt-in: `mcp_tool` bound to a server the same backend declares, the reference checks, registration by declared name, the link in the agent's widget rows when its tool is active, citations through the mapping, and the Workspace MCP returning it (WIDGETS-JSON 5.8).
- Metrics on `/metrics` (DESIGN 11): discoveries, blocks by reason, approvals, file fetches, proxy calls by outcome and status class with their duration, blocked-request reports by directive, and frame failures by plugin, version and kind, which frames now report.
- The conformance suite of GUEST-CONTRACT 8: the shell's semantics in Vitest (`tests/unit/plugins/shell.conformance.test.ts`, running `shell.js` itself) and a real frame in Playwright (`tests/e2e/plugin-conformance.spec.ts`). With it, `model.send` answers anywidget's own `invoke`, the card's refresh reaches the frame as a `refresh` event, and dispose runs cleanups once.
- `AUTHORING.md`, the reference for plugin authors, and `SPIKE.md`, the spike's results in Chromium.
- Declarative proxies and secrets (T1): request templates checked at discovery, the outbound guard (every resolved address checked, the connection pinned to it, TLS verified, no redirects), `core:proxy:call`, write-only secrets from a superuser or the deployment's secrets directory, the server network in the review, the superuser's override with `private-host` and an organization's narrowing, caps, rate limits and value-free logs (SERVER-SIDE 3.5, 4 and 6).
- Plugin backends (T2): `server.backend` with routes (string arguments up to 32,768 characters), `core:backend:call`, the registry and identity check, the RPC with limits and a circuit breaker, the opaque call-context token, the data broker with the user's access and the organization's mapping of data sources, pseudonymous ids, `tcp://host:port` endpoints in the server network for what a backend opens beside HTTPS (a database), the review, the admin page and CLI, and the spike of recipe A on the compose stack (SERVER-SIDE 5.11, 6, SPIKE).
- Plugin-handled widget types get the site's `theme` (`dark` or `light`) in their request, like `markdown` and `html`, and are asked again when it changes (WIDGETS-JSON 4.1).
- Tests: pytest (rules, API, migration, composer, proxies against a real TLS server, the server side through the API, plugin backends and the broker against stand-ins, metrics), Vitest (CSP and server network cases shared with pytest, definition, authority, frame, registry, probe, schema validation, request builder), and Playwright against the compose stack, run in CI: `tests/e2e/plugins.spec.ts` with generated neutral and hostile packages in a mounted plugins directory, `tests/e2e/request-mapping.spec.ts` with an echo backend, `tests/e2e/plugin-proxies.spec.ts` with a keyed HTTPS upstream, `tests/e2e/plugin-admin-journey.spec.ts`, the admin journey through the UI (PLAN Phase 3), `tests/e2e/plugin-conformance.spec.ts`, and `tests/e2e/plugin-backends.spec.ts` with a backend and a data source on the host.

**Not built yet**: the Ines side of the app-builder pages and of the MCP link (not on this branch), recipe B's runner (the spike found it cannot apply every layer in a default container), the Firefox and WebKit runs (spike checks and Playwright), the nightly interop smoke tests with public AFM modules (GUEST-CONTRACT 8), and spike check 9.

| File | What it covers |
|---|---|
| **README** (this file) | The design in short, how it follows the team's direction, answers to its open questions, the decisions needed. |
| [DESIGN.md](DESIGN.md) | The runtime, how plugins reach a deployment, the manifest, registration, RBAC, the backend API, the admin UIs. |
| [GUEST-CONTRACT.md](GUEST-CONTRACT.md) | What plugin code is written against: the Anywidget front-end module contract, the model, commands, exports. |
| [WIDGETS-JSON.md](WIDGETS-JSON.md) | How plugins change the `widgets.json` contract, the dynamic schema that defines every accepted key and value, the request mapping (method and parameter location), and a widget's opt-in to an MCP tool of its backend. |
| [SERVER-SIDE.md](SERVER-SIDE.md) | Declarative proxies, secrets, and plugin backends as separate restricted processes. |
| [SECURITY.md](SECURITY.md) | The threat model, the sandbox, the CSP model (author-declared, admin-overridden), the install path, abuse cases. |
| [PLAN.md](PLAN.md) | Phases, the files each touches, tests, risks. |
| [SPIKE.md](SPIKE.md) | The browser checks of SECURITY 10, run in Chromium, and the decisions they settle. |
| [AUTHORING.md](AUTHORING.md) | The reference for plugin authors: the package, the manifest, the module, permissions, the frame's network, proxies and secrets, checking and porting. |

## What this is

A runtime in Workspace that loads **widget types from external packages**. AgGrid, Plotly and anything else are built and published outside this repository. The deployer puts a package on the server. An admin reviews what it is and what it asks for, and enables it, for everyone or for roles. Users never install or run a plugin. Each widget runs in its own isolated frame that cannot reach the Workspace DOM, session or credentials. The repository ships the runtime, the contract plugins are written against, and the admin and RBAC machinery.

## The design in short

1. **Deployment-level install only.** The deployer places packages in a server-side plugins directory (`WIDGET_PLUGINS_DIR`), bakes them into the image, or sets configuration. The app has no install, upload or fetch-from-URL path for anyone, and no endpoint writes plugin files. The app only decides whether files already on the server may run, and for whom.
2. **Closed by default.** A discovered plugin is disabled. Enabling is an explicit admin action. A new version never takes effect on its own.
3. **A Tauri-style runtime.** A plugin is a package with a manifest. It registers widget types into a host registry. Every call from a plugin to the host passes one permission-checking authority, and permissions are denied unless granted.
4. **The plugin's code is an Anywidget front-end module** (`initialize`, `render`, a `model`, a `signal`), run in one sandboxed iframe per widget instance: an opaque origin, no storage, no access to the parent DOM or to any other widget.
5. **The host delivers the code.** It fetches the bundle, checks its SHA-256 against the digest the admin approved, and sends the bytes into the frame. Before that, a self-test in the frame checks that the sandbox and the CSP are in force; if not, no code is sent.
6. **CSP is data.** The author declares it in the manifest. The Workspace admin approves, edits or overrides it. The platform adds a floor nobody can remove. The browser enforces it, and by default the frame has no network.
7. **Credentials never reach a widget.** The host fetches widget data. Declarative proxies make outbound calls on the server and inject secrets there. Plugin backend code, later, runs as a separate restricted process, never in the API or the worker.
8. **Two admin tiers over the existing RBAC.** Superusers review and approve a version at the deployment. Entity admins enable it for their entity and scope it to everyone or to roles. Everything is audited.
9. **The admin sees what they are deciding.** A trust summary shows what each plugin is, its integrity and everything it asks for, before any enable and before any update. Responsibility for trusting a plugin is the admin's, and the product never says a plugin is safe.
10. **`widgets.json` keeps working, and gets a complete schema.** A backend widget of a type such as `table` or `chart` renders through whichever enabled plugin handles that type. Plugins change two things in the contract: `type` becomes an open set, and `data` gains a `data.<type>` object that the plugin defines. A closed schema, composed per entity from the built-in types and the enabled plugins' fragments, defines every accepted key and value. The contract also gains `method` on the widget, `in` on each param (the query, a header or the body) and `optionsMethod` for option lookups; path params stay `{param}` placeholders in `endpoint`. And `mcp_tool` becomes a defined key: the widget's opt-in to one MCP tool of its own backend, which the agent uses to query that backend (WIDGETS-JSON).

## How it follows the team's direction

| Direction | Design |
|---|---|
| Install and register plugins at the deployment level only | Plugins directory, the image, or configuration. DESIGN 4.1, SECURITY 11. |
| No install button, upload or "request a plugin" flow for users | None exists for anyone. A test asserts that no route writes plugin files. |
| A manifest with id, version, widgets, permissions (data sources, network hosts, secrets) and a checksum | DESIGN 4.4: five permission families, and a required `checksum` the server recomputes. |
| Core and plugin widgets listed separately; plugins disabled by default and explicitly enabled; scoped by role | `/admin/widgets` with two tabs. DESIGN 6.5 and 8. |
| Each widget in its own frame, from a separate origin or sandboxed without `allow-same-origin`, over a small versioned `postMessage` API | One sandboxed iframe per instance with no `allow-same-origin`, over a `MessageChannel`. SECURITY 3, GUEST-CONTRACT. |
| Widgets never see tokens or secrets; the host proxies data calls and injects credentials server-side | SERVER-SIDE 2 to 4. |
| Backend code in a separate process with restricted filesystem and network | SERVER-SIDE 5, after v1. |
| Security responsibility rests with the admin, with clear information | The trust summary and the acknowledgement. DESIGN 8.2, SECURITY 12. |
| Avoid plugin UI in the host page or same origin | Opaque-origin frames. SECURITY 3. |
| Avoid auto-enabling on install and silent updates | Closed defaults; an update needs explicit approval with a diff. DESIGN 4.5 and 10. |
| Avoid a broad or unversioned host API | A short list of permissions and commands, `host.api` 1. GUEST-CONTRACT 4. |
| Avoid treating the iframe as a complete security boundary | The canary verifies the opaque origin and the CSP before any code is sent; the CSP and the host's authority are separate layers. SECURITY 2 and 5. |
| Avoid one widget reading or changing another | One frame per instance, no cross-widget access. GUEST-CONTRACT 1 and 6. |
| Avoid promising that plugins are safe | SECURITY 12. |
| Experiment by running your own copy as the admin | DESIGN 12. |

## Answers to the open questions

1. **Manifest format and permissions.** JSON (`plugin.json`), with a JSON Schema generated from the Zod source like `apps-schema.json`. Permissions come in five families the admin reads side by side: host API permissions per widget (`core:data:read`, ...), network (the frame's CSP and the server side's hosts), secrets (names and purposes, never values), data sources, and identity. The shape follows Tauri's permissions and Looker's entitlements. DESIGN 4.4.
2. **Same-origin sandboxed iframe or separate-origin hosting.** A sandboxed iframe without `allow-same-origin`, which gives an opaque origin. Because the host delivers the code, there are no plugin assets to host on any origin. A dedicated origin is optional hardening later (SECURITY 4.6).
3. **Signing or checksum pinning in v1.** Checksum pinning only: the manifest's `checksum`, recomputed by the server; deployer pins in configuration, with a strict mode that blocks unpinned versions; the admin approves a specific digest; the host re-verifies every file before it reaches a frame. `signatures` is reserved in the manifest. DESIGN 4.3.
4. **Surfacing updates and changed permissions.** A new version never activates on its own. It appears as "update available" while the active version keeps serving. The review screen shows a diff for each family (added and removed permissions, hosts, secrets, data sources, server-side code, widgets, "code changed"), and each added request needs its own acknowledgement before the admin approves. DESIGN 8.2 and 10.

## Walkthrough

An external team publishes a grid package. It is an Anywidget module that renders the `data` trait as a grid and writes the user's filter to a param. Its manifest has `handles: ["table"]` and the permissions `core:data:read`, `core:params:write` and `core:export:provide`. It declares no `csp` and no server side.

1. The deployer copies the package into `<WIDGET_PLUGINS_DIR>/<id>/<version>/`, or builds it into the image, and pins its checksum.
2. A superuser opens `/admin/widgets`, rescans, and opens the plugin's trust summary: what it is, its integrity, "no network access", "no server-side code". The superuser acknowledges and approves this version.
3. An entity admin enables it for the entity, takes over the viz type `table`, and scopes it to the role `Analysts`.
4. A backend declares a widget with `"type": "table"`. For members of `Analysts` it is now in the catalog and renders in the grid. The host fetches the endpoint with the user's own credentials and pushes the rows into `data`; the grid writes a filter to the param; the host refetches.
5. The deployer adds a second version directory. Nothing changes for users. The superuser sees "update available", reads the diff, and approves it, or does not.
6. A charting package that needs a keyed tile service declares a proxy and a secret instead of a network host, so the key stays on the server. A package that does ask for `connect-src` or `img-src` shows "this plugin can send the data it displays to: `<tile-host>`" in its summary.
7. If a package is later found to be unsafe, a superuser revokes it. Every instance becomes a placeholder within about a minute.

## Decisions needed

Settled by the team's direction, and taken as fixed: install only at the deployment; no upload or user-facing install path; disabled by default; role scoping; an explicit enable; no silent updates; credentials never reach widgets; plugin backend code only in a separate restricted process.

| # | Decision | Recommendation | Why |
|---|---|---|---|
| D1 | Who "the admin" is in the UI | A superuser reviews and approves a version at the deployment. An entity admin enables it for the entity and scopes it. | Matches the two admin tiers that exist. The seeded administrator is both, so a single-organization deployment does it in one session. |
| D2 | Who may widen a plugin's CSP, and how much control the admin gets | Superusers widen. Entity admins only narrow. A floor and the validator rules stay, and dangerous sources need a typed confirmation. | A widened policy is a decision about data egress. The floor keeps the sandbox intact whatever is entered. |
| D3 | How the CSP reaches the frame | `srcdoc` with a meta policy in v1. The header route stays an option. | No infrastructure change, one code path in dev, compose and Lite. The cost is that the frame inherits a CSP the SPA may gain later (SECURITY 4.6). |
| D4 | The guest contract | Anywidget AFM 0.11, with a manifest, permissions and bindings around it. | A small existing spec, typings and tooling, and modules that can be re-packaged. It was designed for a trusted page, so the host disables cross-widget access and the sandbox and CSP carry the isolation. |
| D5 | The frontend package format | One bundled `entry.js` (plus optional CSS and assets) and `plugin.json`, in a directory. | The frame has no network, and one file means one digest. Needs confirming with whoever packages AgGrid and Plotly. |
| D6 | Pinning in v1 | Checksum pinning. `WIDGET_PLUGINS_REQUIRE_PINS` defaults to false and the docs recommend true in production. | Pins are onerous in development, essential in production. |
| D7 | What is in v1 | T0 (frontend plugins) and T1 (declarative proxies with secrets). Plugin backends (T2) follow. | T2 needs infrastructure choices and the riskiest review (SERVER-SIDE 7, S1). |
| D8 | Where secret values come from | Deployment configuration, and write-only entry by a superuser. Configuration wins. | SERVER-SIDE 4, S2. |
| D9 | Names | Open: the manifest file name (`plugin.json`), "widget plugin" as the term, the setting names. | Needed before the first release, not before the spike. |
| D10 | Where to build it | A new `feature/widget-plugins` off `origin/develop`, after the current branch lands. | The current branch has uncommitted edits in files this plan touches. |
| D11 | The `widgets.json` contract | Unknown keys are errors; plugin configuration lives in `data.<type>`; the schema is composed once, in the API, per entity; the SPA validates with `ajv`; internal keys such as `widgetId` leave the contract. A widget declares `method` (`GET` or `POST`), each param declares `in` (`query`, `header` or `body`), and `endpoint` params declare `optionsMethod`. Path params stay `{param}` placeholders in `endpoint`. A `?` or `#` in an endpoint is an error. The endpoint probe sends `OPTIONS` to every route and runs no widget. A widget opts in to one MCP tool of its own backend with `mcp_tool`, bound to a server that backend declares in its `apps.json`. | WIDGETS-JSON 7: C1 to C6 and A1 to A4 are open; the rest is settled. Closing the contract, adding request mapping and fixing the MCP link can ship first, with no plugins. |

## State of this work

These files are new and untracked in the working tree, on `feature/ines-agent-and-dead-route-fixes`. Nothing is staged, committed or linked from the top-level `README.md`, so they do not collide with that branch's own edits. When they are committed they belong on their own `feature/` branch off `develop`.

Browser behavior this design relies on is listed in SECURITY 10 and checked in Phase 0 before any production code is written.
