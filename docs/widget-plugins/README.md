# Widget plugins

Workspace loads widget types from external packages. A package is built outside this repository, placed on the server by whoever deploys Workspace, reviewed and approved by a superuser, and enabled for roles by an organization's admin. Each widget runs in its own sandboxed frame and never receives credentials.

| File | For |
|---|---|
| **README** (this file) | What plugins are, how they run, and how a deployment places, reviews and enables them. |
| [AUTHORING.md](AUTHORING.md) | Plugin authors: the package, the manifest, the module contract, permissions, proxies, backends. |
| [WIDGETS-JSON.md](WIDGETS-JSON.md) | Backend authors: the `widgets.json` contract, its schema, how requests are built, `raw` rows and the MCP tool link. |
| [SECURITY.md](SECURITY.md) | Reviewers: the threat model, the sandbox, the CSP rules and the tests behind them. |

Working examples are in [`docs/examples/`](../examples/README.md).

## 1. What a plugin is

A plugin is a directory with a manifest (`plugin.json`), one bundled module (`entry.js`), optional styles and assets, and optionally a server-side `backend/`. Its module is an [Anywidget front-end module](https://anywidget.dev/en/afm/). A plugin contributes widgets that:

- render a type a backend's `widgets.json` declares (for example `"type": "plotly"`), with data the host fetches;
- or stand alone in Add widget, configured by their settings;
- call proxies the manifest declares, which the API makes with secrets added on the server;
- call the plugin's own backend, which the deployment runs as a separate process.

Nobody installs a plugin from the app. The app has no upload, no fetch from a URL and no endpoint that writes plugin files. It decides only whether files already on the server may run, and for whom.

## 2. How it compares

| Part | Like | What it gives |
|---|---|---|
| Permissions checked on every call, denied unless granted | Tauri's capabilities and runtime authority | A plugin can do only what its manifest asks for and an admin approved. |
| A review of what a version asks for before it runs; an update that asks for more waits | A browser extension that is paused until the user accepts the new permissions of its update | Nothing new takes effect without an admin's action. |
| The module contract | Anywidget in Jupyter | Existing anywidget modules can be re-packaged. |
| One sandboxed frame per widget, talking over a private message channel | Figma's plugin iframes | Plugin code cannot reach the page, the session or another widget. |
| Approval bound to a digest of the files | A container image pinned by digest | The code that runs is the code that was approved. |
| Proxies declared in the manifest, secrets added by the server | Grafana's data source proxy routes | A key never reaches the browser. |
| A backend as its own process | Grafana's backend plugins | Plugin server code never runs inside the API. |
| No install from the app | Grafana with `plugin_admin_enabled` off, WordPress with `DISALLOW_FILE_MODS` | A stolen admin session cannot deploy code. |

## 3. How it runs

```
Browser tab (Workspace)
  the host: PluginWidget fetches the widget's data with the user's session,
            pushes it into the frame, and checks every command against the
            widget's permissions
     |  MessageChannel port, private to one frame
  <iframe sandbox="allow-scripts" srcdoc="...">   opaque origin, no storage
     the shell: the policy in a <meta> tag, a self-check (the canary),
                then the plugin's module, checked against its digest

Workspace API
  reads the plugins directory (read-only), records reviews and grants,
  serves files after re-hashing them, makes proxy calls, routes backend calls,
  answers a backend's data requests for the calling user

Plugin backend (optional)
  a separate process or container the deployer runs and isolates
```

A frame starts in this order: the host gets the user's plugin list (`GET /app/widget-plugins`), creates the frame with the policy the API composed, hands it a port, and waits for the shell's canary to prove that the origin is opaque and the policy is enforced. Only then does it fetch the plugin's files, check each one's SHA-256 against the approved digest, and send them in. The module's `initialize` and `render` run, and from then on the host pushes data, params and theme into the model and answers the module's commands. SECURITY.md has the details.

## 4. Who does what

| | Deployer | Superuser | Organization admin | Role members |
|---|---|---|---|---|
| Place a package, pin its digest, run its backend | yes | | | |
| Rescan, review and approve a version; revoke, restore, forget | | yes | | |
| Override the frame's policy and the server network; set secrets | | yes | | |
| Enable for organizations | | yes, any | their own | |
| Choose which plugin renders a type; settings; narrow permissions, policy and hosts; map data sources | | | their own | |
| Grant widget types to roles | | | their own | |
| Use the widgets | | | through a role | through a role |

A widget type is available to a user when the plugin is enabled, its active version is approved, the user's organization has enabled it, and one of the user's roles grants that widget or all of the plugin's widgets. Admins are no exception: they use a plugin through a role like everyone else. The seeded administrator is both superuser and organization admin, so on a single-organization deployment one person does the whole flow.

## 5. Lifecycle

1. The deployer places `<WIDGET_PLUGINS_DIR>/<plugin-id>/<version>/`.
2. A superuser rescans (Admin, Widgets, Deployment, or `plugin rescan`). The new version is `discovered`, or `blocked` with the reason.
3. The superuser reviews the version and approves it. Every request added since the active version (a permission, a frame source, a server host, a proxy, a secret, a backend route, a data source, the pseudonymous id) needs its own acknowledgement, and the approval binds to the digest that was reviewed. The first approval enables the plugin at the deployment.
4. An organization admin enables it for the organization (Admin, Widgets, Plugin widgets) and grants its widget types to roles (Admin, Roles and Access, the role's Widget plugins action).
5. For members of those roles, backend widgets of the types it handles render through it, and its standalone widgets are in Add widget.

A new version directory is `discovered` and waits; the active version keeps serving until a superuser approves the new one, which retires the old one. Organization settings and role grants carry over.

| State | Of | Meaning |
|---|---|---|
| `disabled`, `enabled`, `revoked` | the plugin | `disabled` until its first approval. `revoked` is the kill switch: the plugin leaves every user's list at its next refresh (within a minute), and proxy and backend calls are refused at once. Restore undoes it. |
| `discovered` | a version | Found and checked, not approved. |
| `active` | a version | The one version that serves. |
| `retired` | a version | Was active; can be approved again. |
| `blocked` | a version | A check failed, or its files changed after discovery. Versions are immutable, so the deployer publishes a new version. |
| `missing` | a version | Its directory is gone. When every version is missing, a superuser can forget the plugin, which deletes its reviews, grants, settings and secrets. |

## 6. Deploying

### 6.1 The plugins directory

```
<WIDGET_PLUGINS_DIR>/
  <plugin-id>/
    <version>/
      plugin.json
      entry.js
      entry.css         optional
      assets/           optional
      backend/          optional, never served to browsers
```

Mount it read-only into the API. With the root `docker-compose.yml`, add an override file and set `WIDGET_PLUGINS_DIR=/opt/widget-plugins` in `backend-api/backend/envs/.env`:

```yaml
services:
  api:
    volumes:
      - <plugins directory>:/opt/widget-plugins:ro
      - <plugin secrets directory>:/run/secrets/widget-plugins:ro
```

```bash
docker compose -f docker-compose.yml -f compose.plugins.yml up -d
```

The second mount is needed only for secrets set by the deployment (6.4). For the local stack, see `local/LOCAL_SETUP.md`, Widget plugins.

A rescan reads every version directory: it refuses symbolic links, odd file names and anything over the caps, parses and validates the manifest, hashes every file, checks the manifest's `checksum` and any pin, and records what it found. A remote import in the entry, or `eval` without `'unsafe-eval'`, is a warning that does not block. The API re-hashes a file whenever its size or modification time changes before serving it, and a file that no longer matches blocks its version. The API scans only when asked, never at startup.

### 6.2 Settings

All in the API's environment. Unset `WIDGET_PLUGINS_DIR` turns the feature off.

| Setting | Default | |
|---|---|---|
| `WIDGET_PLUGINS_DIR` | unset | The plugins directory. |
| `WIDGET_PLUGINS_PINS` | `{}` | `{"<id>@<version>": "sha256-..."}`: a version whose digest differs is blocked. |
| `WIDGET_PLUGINS_REQUIRE_PINS` | `false` | Block every version without a pin. Use it in production. |
| `WIDGET_PLUGINS_MAX_FILES`, `WIDGET_PLUGINS_MAX_UNPACKED_BYTES` | 200, 64 MiB | Caps per version. |
| `WIDGET_PLUGIN_SECRETS_DIR` | unset | Secret values set by the deployment (6.4). |
| `WIDGET_PLUGIN_PROXY_MAX_BYTES`, `WIDGET_PLUGIN_PROXY_TIMEOUT_MS` | 5 MiB, 30000 | Caps on every proxy call. |
| `WIDGET_PLUGIN_PROXY_CONCURRENCY` | 8 | Proxy calls of one plugin at once, per API process. |
| `WIDGET_PLUGIN_PROXY_RATE_PER_USER`, `WIDGET_PLUGIN_PROXY_RATE_PER_PLUGIN` | `60/minute`, `600/minute` | Proxy rate limits. |
| `WIDGET_PLUGIN_PROXY_CA_FILE` | unset | A certificate authority proxies trust besides the system's. |
| `WIDGET_PLUGIN_BACKENDS` | `{}` | `{"<plugin id>": "<internal URL>"}`, an `http(s)` URL or `unix:<socket path>`: the backends the API may call (6.5). |
| `WIDGET_PLUGIN_BACKEND_MAX_BYTES`, `WIDGET_PLUGIN_BACKEND_TIMEOUT_MS` | 5 MiB, 30000 | Caps on every backend call. |
| `WIDGET_PLUGIN_BACKEND_CONCURRENCY` | 8 | Backend calls of one plugin at once, per API process. |
| `WIDGET_PLUGIN_BACKEND_RATE_PER_USER`, `WIDGET_PLUGIN_BACKEND_RATE_PER_PLUGIN` | `60/minute`, `600/minute` | Backend rate limits. |
| `WIDGET_PLUGIN_BACKEND_BREAKER_FAILURES`, `WIDGET_PLUGIN_BACKEND_BREAKER_SECONDS` | 5, 30 | After that many failures in a row, calls fail fast for that long, then one goes through. |
| `WIDGET_PLUGIN_BACKEND_IDENTITY_SECONDS` | 60 | How long a backend's identity answer is trusted. |

### 6.3 Pins

`python -m scripts.plugin_check --digest <dir>`, run from `backend-api/backend`, prints a version's `checksum` (every file but `plugin.json`) and its version digest (every file). Pin the version digest in `WIDGET_PLUGINS_PINS` to have a version whose files differ blocked at rescan.

### 6.4 Secrets

A plugin declares secrets by name and purpose; values come from the deployment. Either a file `<WIDGET_PLUGIN_SECRETS_DIR>/<plugin id>/<secret name>` (its final line break is dropped, so a mounted Docker or Kubernetes secret works), or a superuser sets the value on the plugin's Deployment page or with `plugin secret set`. A file wins, and the page then shows the value as set by configuration. Values are encrypted at rest with `WORKSPACE_AES_KEY`, sent only in the requests that declare them, and never returned, logged or shown again.

### 6.5 Plugin backends

The repository ships no backend runner. For a plugin with `backend/`, the deployer builds an image from it, runs it isolated, and lists it in `WIDGET_PLUGIN_BACKENDS`. Before routing to it, the API asks it for `GET /.workspace/identity` and routes nothing while the answer is not the active version's id, version and digest.

Run each backend as its own container with no privileges, no deployment mounts and no route to the database, the cache or the API's other endpoints:

```yaml
services:
  plugin-<plugin-id>:
    image: <the image built from the plugin's backend/>
    user: "<unprivileged uid>:<gid>"
    read_only: true
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
    tmpfs: ["/tmp:size=64m,noexec,nosuid"]
    mem_limit: <limit>
    pids_limit: <limit>
    environment: {}
    networks: [plugin-rpc, plugin-egress]
  plugin-gateway:
    image: <a reverse proxy>
    networks: [<the API's network>, plugin-rpc]
  plugin-egress:
    image: <an allowlisting forward proxy>
    networks: [<an outside network>, plugin-egress]
networks:
  plugin-rpc: { internal: true }
  plugin-egress: { internal: true }
```

Compose networks cannot restrict ports, so the gateway stands between the API and the backends: it forwards the API's calls to each backend (`WIDGET_PLUGIN_BACKENDS` names the gateway's address for it) and passes from the backends only `POST /internal/plugin-broker/...` to the API. A backend that reads data through that route sends the web app's origin as its `Origin`, like every caller of the API. The egress proxy lets the backend reach only the hosts the plugin's approved server network names. On Kubernetes the same is a security context and a network policy. The API's kill switch is to stop routing; stopping the container is the deployer's.

## 7. Reviewing and enabling

**Admin, Widgets** has three tabs.

- **Plugin widgets** (organization admins), per plugin approved at the deployment:
  - Enabled, for the organization.
  - Widget types, and which plugin renders a type two plugins handle.
  - Settings.
  - Narrow: remove permissions, frame sources and server hosts for the organization.
  - Data sources: which of the organization's backends serves each data source a plugin backend declares.
- **Core widgets**: the built-in types, read-only.
- **Deployment** (superusers): every discovered plugin with its status, active version and what it asks for. A plugin's page has:
  - Versions, and the review (what it is, integrity, the frame's network, egress, the server side) with Approve.
  - Revoke, Restore and Forget.
  - Enabled for: organizations, one at a time or all.
  - Overrides: the frame's policy by directive and the server network, with confirmations for `insecure-scheme`, `private-host` and `remote-script`.
  - Secrets, and Backend (registration, identity, Check now).
  - Activity, and Blocked requests with an Allow action that opens the override with that source.

**Admin, Roles and Access**: a role's Widget plugins action grants all of a plugin's widget types or chosen ones. The grants appear in the activity log. A superuser's entity dialog lists the plugins the organization has enabled.

**The admin CLI** runs inside the API container on the database and does what the superuser's pages do: `docker compose exec api python -m scripts.workspace_admin plugin <action>`.

| Action | |
|---|---|
| `list`, `rescan`, `show <id>` | What is discovered, a fresh scan, one plugin in full. |
| `approve <id> <version> [--digest <d>] [--acknowledge]` | Without `--acknowledge` it prints the review and approves nothing. `--digest` stops when the server's files are not the ones you checked. |
| `revoke <id>`, `restore <id>`, `forget <id>` | The kill switch, its undo, and forgetting a plugin whose files are gone. |
| `enable` or `disable <id> (--entity <uuid> \| --all)` | For one organization or all. |
| `grant` or `ungrant <id> --role <uuid> [--widget <w>]` | Role grants. |
| `override <id> (--csp-file <json> \| --server-network <origin> ... \| --clear) [--confirm ...]` | The superuser's overrides. |
| `secret set` or `clear <id> <name>` | The value is read without echo, or from standard input, never from an argument. |
| `check-backend <id>`, `events <id>`, `reports <id>` | The backend's identity now, the plugin's events, its blocked requests. |

**The API.** Superuser routes are under `/plugins`, organization-admin routes under `/admin/plugins` and `/admin/role/{role_uuid}/plugin-access`, user routes under `/app/widget-plugins`, and the backends' data route is `POST /internal/plugin-broker/data/{data_source_id}`. All are in `routers/widget_plugins.py` and carry the `widget-plugins` tag.

| Route | Who | |
|---|---|---|
| `GET /plugins`, `GET /plugins/{id}`, `POST /plugins/rescan` | superuser | Listing, detail with the review, rescan. |
| `POST /plugins/{id}/versions/{version}/approve` | superuser | Body: the digest reviewed and the acknowledgements. |
| `POST /plugins/{id}/revoke`, `.../restore`, `DELETE /plugins/{id}` | superuser | Kill switch, undo, forget. |
| `PUT /plugins/{id}/overrides`, `PUT` and `DELETE /plugins/{id}/secrets/{name}` | superuser | Overrides; set or clear a secret. |
| `PUT /plugins/{id}/entities`, `PUT /plugins/{id}/entities/{entity_uuid}` | superuser | Enable for all organizations or one. |
| `POST /plugins/{id}/backend/check`, `GET /plugins/{id}/events`, `GET /plugins/{id}/csp-reports` | superuser | Backend identity, events, blocked requests. |
| `GET /admin/plugins`, `PUT /admin/plugins/{id}`, `GET /admin/plugins/{id}/events`, `GET /admin/plugins/{id}/csp-reports` | organization admin | The organization's view and settings. |
| `GET` and `PUT /admin/role/{role_uuid}/plugin-access` | organization admin | Role grants. |
| `GET /app/widget-plugins` | user | `{ enabled, etag, plugins, vizHandlers }`: what this user may use. |
| `GET /app/widget-plugins/widgets-schema` | user | The organization's `widgets.json` schema (WIDGETS-JSON 3.5). |
| `GET /app/widget-plugins/{id}/{digest}/files/{path}` | user with access | One file of the active version, as `application/octet-stream` with `Content-Disposition: attachment`. |
| `POST /app/widget-plugins/{id}/proxy/{proxy_id}`, `.../backend/{route_id}` | user with access | A proxy or backend call. |
| `POST /app/widget-plugins/report` | user | Frame failures and blocked requests. |

## 8. What users see

- Backend widgets of a type a plugin handles are in the catalog and render through the plugin; standalone plugin widgets are in Add widget.
- The card is the usual one: title, params, refresh, the Copilot, fullscreen, a settings form from the widget's `settings`, and Export when the plugin offers one (AUTHORING 4.5). The frame follows the site's light or dark mode without restarting.
- A widget that cannot run keeps its place and its settings and shows why: "This widget type is not available to you", "Plugin sandbox unavailable", "Failed to load", "Plugin error", "Not responding" or "The widget was stopped".

## 9. Watching it

- **Events.** Versions found, changed, gone or back, approvals, blocks, revocations and restores, overrides, an organization's enablement and settings, secrets set or cleared, and backend mismatches are recorded per plugin: the Activity section, `plugin events`.
- **Blocked requests.** What a frame's policy refused, by directive and origin, kept 30 days, at most 200 origins per plugin, shown as text.
- **Metrics** on `/metrics` when `PROMETHEUS` is on: `widget_plugin_discoveries_total`, `widget_plugin_blocks_total{reason}`, `widget_plugin_approvals_total`, `widget_plugin_file_fetches_total{outcome}`, `widget_plugin_proxy_calls_total`, `widget_plugin_proxy_call_seconds`, `widget_plugin_backend_calls_total`, `widget_plugin_backend_call_seconds`, `widget_plugin_backend_identity_checks_total`, `widget_plugin_broker_calls_total`, `widget_plugin_csp_reports_total{directive}` and `widget_plugin_frame_failures_total{plugin, version, kind}`. Plugin labels are counted only for a plugin the caller may use.
- **Logs.** One line per proxy, backend and broker call: plugin, widget, outcome, bytes and duration, never arguments, bodies or secrets.

## 10. Where the code is

| | |
|---|---|
| `backend-api/backend/api/widget_plugins/` | `discovery.py` (scan and checks), `manifest.py`, `csp.py` (the policy rules), `service.py` (reviews, availability, files, reports), `proxy.py` and `calls.py` (proxies and the outbound guard with `utilities/egress.py`), `backends.py` and `broker.py`, `secrets.py`, `metrics.py`, `widgets_schema.py` (WIDGETS-JSON 3) |
| `backend-api/backend/routers/widget_plugins.py` | Every route above. |
| `backend-api/backend/api/models/widget_plugin_models.py` | The tables: `widget_plugin`, `widget_plugin_version`, `entity_widget_plugin`, `entity_viz_handler`, `role_widget_plugin`, `widget_plugin_secret`, `widget_plugin_event`, `widget_plugin_csp_report`. |
| `backend-api/backend/scripts/` | `plugin_check.py`, `workspace_admin.py` (`plugin ...`), `compose_widgets_schema.py`. |
| `frontend/src/plugins/` | `registry.ts`, `PluginWidget.tsx`, `PluginFrame.tsx`, `frame.ts` (the frame document), `shell/shell.js`, `authority.ts`, `bundle.ts`, `csp.ts`, `protocol.ts`, `theme.ts`. |
| `frontend/src/components/AdminPlugins/`, `frontend/src/routes/admin/widgets.tsx` | The Widgets page. |
| Tests | `backend-api/backend/tests/test_widget_plugin*.py`, `frontend/tests/unit/plugins/`, and the Playwright specs `frontend/tests/e2e/plugins.spec.ts`, `plugin-admin-journey.spec.ts`, `plugin-conformance.spec.ts`, `plugin-proxies.spec.ts` and `plugin-backends.spec.ts`, run in Chromium, Firefox and WebKit by `e2e.yml`. `plugin-interop.spec.ts` runs when `E2E_INTEROP` is set: `plugin-interop.yml` sets it on a nightly schedule, which GitHub runs from the default branch. `examples.yml` runs the example plugins' tests, the SQL explorer's against a Postgres and its compose deployment in Docker. |
