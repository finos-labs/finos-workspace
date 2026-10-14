# Widget plugins: server-side parts

Status: proposal, 2026-10-09. T1 (proxies and secrets) built 2026-10-13; see 3.5, 4 and 6. T2 (plugin backends) built 2026-10-13; see 5.11, and the spike in [SPIKE](SPIKE.md#plugin-backends).

Files: [README](README.md) · [DESIGN](DESIGN.md) · [GUEST-CONTRACT](GUEST-CONTRACT.md) · [WIDGETS-JSON](WIDGETS-JSON.md) · **SERVER-SIDE** · [SECURITY](SECURITY.md) · [PLAN](PLAN.md) · [SPIKE](SPIKE.md) · [AUTHORING](AUTHORING.md)

The team's direction sets three rules for the server side. Widgets never see tokens or secrets. The host proxies data calls and injects credentials server-side. Plugin backend code runs as a separate process with restricted filesystem and network access, never in the host process. This file turns those rules into three tiers and says what each one needs.

Nothing here makes a plugin "safe". It limits what a plugin can reach and tells the admin what it asks for. The admin decides whether to trust it.

## 1. Three tiers

| Tier | What it is | Server-side plugin code | Release |
|---|---|---|---|
| T0 | A frontend plugin. The host fetches the widget's data (backend widgets work as today) and pushes it into the frame. | none | v1 |
| T1 | T0 plus **declarative proxies**. The manifest describes outbound HTTP calls. The API makes them and injects secrets. | none: the API executes a declared request template | v1 |
| T2 | T1 plus a **plugin backend**: code in the package that runs as a separate process with restricted filesystem and network. | yes, isolated | after v1 |

A plugin uses the lowest tier that works. A grid or a chart package is normally T0. A package that needs a keyed third-party API is T1. T2 is for logic that cannot run in the browser. The admin sees the tier in the trust summary as "runs code on the server: yes or no".

## 2. Rules in every tier

1. **The frame never sees a credential.** Not the session token, not the deployment's service token, not a backend's endpoint headers, not a plugin secret.
2. **Credentials are injected server-side.** One note on what exists today: for backend widgets the SPA already receives the backend's `endpointHeaders` (users with access get them, `routers/app/helpers.py:1599`) and calls the backend itself. That stays. Plugin code never sees them because the host does the fetch. Plugin-owned secrets never reach the browser at all.
3. **The only path is SPA, API, server-side part.** The frame has no direct path to the server, and the SPA has no direct path to a backend process.
4. **Every call is authorized like any API call**: a signed-in user, the plugin available to that user (RBAC), the permission granted, the proxy or route declared by the widget.
5. **Everything is capped and logged**: size, time, rate. Logs carry plugin, proxy or route, status, duration and byte counts, never bodies, argument values or secrets.
6. **Revoking a plugin stops its server-side use at once.** Each call checks the plugin's status.

## 3. Declarative proxies (T1)

### 3.1 In the manifest

```jsonc
"server": {
  "network": ["https://<host>"],                 // what the server side may contact; approved like the CSP
  "proxies": [
    {
      "id": "<proxy-id>",
      "method": "GET",                           // GET or POST in v1
      "url": "https://<host>/<path>/${arg:<name>}",
      "query": { "<param>": "${arg:<name>}" },
      "headers": { "Authorization": "Bearer ${secret:<secret-name>}" },
      "body": null,
      "args": { "<name>": { "type": "string", "maxLength": 64 } },
      "response": { "accepts": ["application/json"], "maxBytes": 5242880, "timeoutMs": 10000 }
    }
  ]
},
"secrets": [ { "name": "<secret-name>", "purpose": "<why>" } ]
```

A widget names the proxies it may call in `contributes.widgets[].server.proxies`.

### 3.2 Template rules

- `${arg:<name>}` may appear in `query` values, path segments (URL-encoded) and JSON body fields. Never in the scheme, host or port.
- `${secret:<name>}` may appear in header values and in HTTP basic credentials only, and must name a declared secret. Never in a path, query or body, so a secret never lands in a URL or a log line.
- Nothing else is substituted. No conditionals, no loops, no expressions.
- The host part of `url` is a literal and must be on the approved `server.network` list.
- `args` types are `string`, `number`, `boolean` and `enum`, with `maxLength`, `minimum` and `maximum`. Unknown arguments are refused.
- Redirects are not followed in v1.

### 3.3 What the API checks before it calls out

1. The caller, the plugin's availability for that user, the effective permission `core:proxy:call`, and that the widget declares this proxy.
2. The arguments against their declared types.
3. The built URL: https only, host on the approved list, DNS resolved by the API, **every** resolved address outside loopback, private, link-local, shared-address, multicast and cloud-metadata ranges (IPv4 and IPv6) unless the superuser approved `private-host`. The connection goes to the address that was checked, so a second DNS answer cannot redirect it. TLS verification stays on.
4. Secrets resolved by name. A missing secret fails the call with `secret_missing` and nothing is sent.
5. Time and size caps while streaming the response, then the rate limits.

The response goes back as JSON or text within `maxBytes`. Of the upstream headers only `Content-Type` is kept. A non-2xx upstream answer becomes `upstream_error` with a status class and no body.

The check at `routers/app/index.py:1300` (the MCP proxy's URL guard) only matches `localhost` and dotted IPv4 literals. It is not enough for this. The plugin proxy needs the stricter guard above, extracted into a shared helper.

### 3.4 From the frame

`invoke("core:proxy:call", { id, args })` resolves to `[body, buffers]` (GUEST-CONTRACT 4). The frame sends an id and arguments. It never builds a URL or a header.

### 3.5 As built

- **Where.** The templates, their rules and the call are `backend-api/backend/api/widget_plugins/proxy.py`. The outbound guard is `utilities/egress.py`, a shared helper with no plugin knowledge. Authorization, limits and logging are `api/widget_plugins/calls.py`. The route is `POST /app/widget-plugins/{plugin_id}/proxy/{proxy_id}` with the body `{"widget": "<widget id>", "args": {...}}`; it answers `{"content_type", "body"}`.
- **Templates.** A proxy declares `id`, `method` (`GET` or `POST`), `url`, `query`, `headers`, `body` (a flat object, `POST` only), `args` and `response` (`accepts` from `application/json`, `text/plain`, `text/csv`, `text/markdown`, `text/html`, `application/xml`; `maxBytes` up to 25 MiB; `timeoutMs` up to 30 seconds). Discovery blocks a package whose template breaks a rule of 3.2, whose widget names an undeclared proxy, whose widget names proxies without `core:proxy:call` or has it without proxies, or that declares secrets and no proxy. Headers that change how a request travels (`Host`, `Content-Length`, `Content-Type`, `Transfer-Encoding`, `Connection`, `Cookie`, `Accept-Encoding`, `Forwarded`, `X-Forwarded-*`, `Sec-*`, `Proxy-*` and the like) cannot be set. A `${arg}` in the path is encoded as one segment and required; a query value or body field whose argument is absent is left out; a body field that is one `${arg}` keeps the argument's type.
- **The guard.** `check_destination` resolves the name with the API's resolver and refuses it when any address is in a blocked range: this network, private, shared, loopback, link-local (with the metadata address), the IETF and documentation ranges, benchmarking, multicast, reserved and broadcast in IPv4; unspecified, loopback, NAT64, discard, the IETF and documentation ranges, 6to4, unique local (with `fd00:ec2::254`), link-local and multicast in IPv6; an IPv4-mapped address is checked as the IPv4 it maps. The request goes to the checked address with the name kept for the `Host` header and for TLS (SNI and the certificate's name), so a second DNS answer cannot move it. Redirects are not followed. The answer is asked for uncompressed and refused when it comes compressed, so the size cap counts the bytes received.
- **Limits.** The manifest's `maxBytes` and `timeoutMs` are capped by `WIDGET_PLUGIN_PROXY_MAX_BYTES` (5 MiB) and `WIDGET_PLUGIN_PROXY_TIMEOUT_MS` (30 seconds); calls of one plugin running at once per API process by `WIDGET_PLUGIN_PROXY_CONCURRENCY` (8); the rate per user and plugin and per plugin by `WIDGET_PLUGIN_PROXY_RATE_PER_USER` (`60/minute`) and `WIDGET_PLUGIN_PROXY_RATE_PER_PLUGIN` (`600/minute`), counted in the API's rate limit storage. `WIDGET_PLUGIN_PROXY_CA_FILE` names a certificate authority the proxies trust besides the system's, for an upstream with a private CA.
- **Errors** have a stable code: `not_available` (404), `permission_denied` and `unknown_proxy` (403), `invalid_args` (422), `secret_missing` (409), `egress_refused` (403), `rate_limited` and `busy` (429), `timeout` (504), `upstream_unreachable`, `upstream_error` (the status class only), `unsupported_content_type` and `response_too_large` (502). The host turns them into the frame's error names (`not_granted`, `out_of_scope`, `invalid_args`, `rate_limited`, `timeout`, `too_large`, otherwise `unavailable`).
- **No values in logs.** A call logs one line: plugin, widget, proxy, outcome, bytes and duration. An unexpected error logs its type only, since an error's text can carry a URL with arguments. The routes that receive a secret value or a call's arguments read their body and check their path by hand, because the app's validation handler logs the input of a request that fails validation.
- **From the frame.** The host refuses a proxy the widget does not list, `args` that are not an object, and more than about two calls a second, before the API sees them. Whatever else the frame puts in its message, a URL included, is not read. The user listing gives each widget the proxies it may call, empty when `core:proxy:call` is narrowed away.
- **Tests.** `tests/test_widget_plugin_proxies.py` (templates, the manifest, building, the guard's ranges and mixed DNS answers, a resolver that rebinds, and calls to a real TLS server: the secret injected, the certificate verified, 5xx, redirects, size, type, compression and time) and `tests/test_widget_plugin_server_side.py` (the review, write-only secrets, the override, narrowing, calls through the API with every refusal, revocation, the rate limit, and logs without values). `tests/e2e/plugin-proxies.spec.ts` runs it on the compose stack: a superuser sets the secret and the override in the admin page, the plugin's frame calls a keyed HTTPS upstream on the runner whose name resolves to a private address and whose certificate a CA made for the run signs (`tests/e2e/plugins/make-proxy-tls.sh`), and neither the frame nor the page receives the secret.
- **The MCP proxy's guard** (`routers/app/index.py`) is unchanged: it serves connections a user configures, often to hosts on the deployment's own network. Adopting `utilities/egress.py` there is a separate decision.

## 4. Secrets

- **Declared by name and purpose**, never by value, in the manifest. The admin reads the purpose in the trust summary.
- **Values** come from deployment configuration (an environment variable or a file the deployer mounts) or are entered by a superuser in the admin UI, write-only. Whichever is set, the UI shows "set" or "not set", who set it and when, and never the value. A value set by configuration takes precedence and makes the UI field read-only. Which of the two routes to support is decision S2.
- **Stored** encrypted at rest with the existing `EncryptedType` and `WORKSPACE_AES_KEY`, in `widget_plugin_secret`. Per-entity values are a later extension.
- **Injected** by the API into an outbound request (T1) or into the request to a backend, only the secrets the proxy or route declares (T2).
- **Never** returned by any endpoint, placed in the plugin listing, sent to the browser, written to logs, metrics, audit details or the CSP report feed, or given to a frame.
- **Rotation** is overwriting the value. **Removal** of a plugin deletes its secrets. **Revoking** a plugin stops injection immediately.

As built (decision S2: both routes). The deployment's value is the file `<WIDGET_PLUGIN_SECRETS_DIR>/<plugin id>/<secret name>`, without its final line break, so a mounted Docker or Kubernetes secret works; a variable per secret is not read, because plugin ids and secret names do not map to variable names one to one. A superuser sets a value with `PUT /plugins/{plugin_id}/secrets/{name}` (`{"value": "..."}`) and clears it with `DELETE`; the CLI's `plugin secret set <id> <name>` reads it without echo or from standard input. A value is printable ASCII, at most 4096 characters, and is stored as `{"value": ...}` in an `EncryptedType` column. A secret can be set once any recorded version declares it, so it can be in place before that version is approved. The plugin's page lists each secret with set or not set, the source (configuration or admin), who set it and when, a problem with a configured value, and a stored value no version declares any more, which a superuser can clear. Setting a secret the deployment sets is refused. Events `secret-set` and `secret-cleared` carry the name only. Forgetting a plugin deletes its secrets explicitly as well as through the foreign key, so a plugin that returns under the same id starts without them. A secret is resolved for each call, so a new value applies to the next call.

## 5. Plugin backends (T2)

### 5.1 What a backend is

Code in the package's `backend/` directory, started and isolated by whoever deploys Workspace, speaking a small HTTP contract to the API (5.6). It exists for logic that cannot run in the browser or be described as a request template. It runs on the same server as the deployment, as its own process, never inside the API or the worker.

### 5.2 Requirements

| # | Requirement |
|---|---|
| R1 | A separate process. Never in the API or worker process or interpreter. |
| R2 | Its own unprivileged identity. Not root, and not the user of the API or the worker. |
| R3 | Restricted filesystem: its code read-only, a private size-limited scratch area mounted `noexec`, and nothing of the deployment mounted: no `.env`, no `user_create.json`, no storage volume, no Docker socket, no other plugin's directory. |
| R4 | Restricted network. The only way in is the API's RPC. No route to the database, the cache, the API's other endpoints or other plugin backends. Outbound only to the approved `server.network` hosts, through an enforcing egress point; DNS through the same point. |
| R5 | Resource limits: CPU, memory, process count, file descriptors, time per request, body size, concurrency. |
| R6 | No secrets in its environment or image. Secrets arrive per request, only the declared ones, and the platform never logs or stores them. |
| R7 | Integrity: the code that runs is the code the admin approved (5.5). |
| R8 | A narrow, versioned contract: the RPC (5.6) and the broker (5.7), nothing else. |
| R9 | Observable: per-call audit and metrics, a health endpoint, crash isolation, a stop switch. |
| R10 | It cannot start other containers or processes outside its sandbox. |

### 5.3 Recipe A: one hardened container per backend (recommended baseline)

The deployer builds an image from the plugin's `backend/` and runs it as its own service, "baked into the deployment bundle". The container runtime provides the isolation, so R1 to R5 and R10 are settings, not code the platform has to get right. This is an illustration, validated in the Phase 6 spike:

```yaml
services:
  plugin-<plugin-id>:
    image: <the image the deployer built from the plugin's backend/>
    user: "<unprivileged uid>:<gid>"
    read_only: true
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
    tmpfs: ["/tmp:size=64m,noexec,nosuid"]
    mem_limit: <limit>
    pids_limit: <limit>
    environment: {}                  # no deployment secrets, no database settings
    networks: [plugin-rpc, plugin-egress]
networks:
  plugin-rpc:    { internal: true }  # the API and the plugin backends only
  plugin-egress: { internal: true }  # the plugin backends and the egress proxy only
```

The API joins `plugin-rpc`. An egress proxy joins `plugin-egress` and the outside network, and allows only the hosts the admin approved. On Kubernetes the same settings are a security context (`readOnlyRootFilesystem`, `runAsNonRoot`, dropped capabilities, the runtime default seccomp profile) and a network policy.

As built (the spike). In Compose a network cannot restrict ports, so a backend on the same network as the API can reach every endpoint of the API, not only the broker (R4). The recipe therefore puts a small **RPC gateway** on `plugin-rpc` instead of the API: it joins the API's network and `plugin-rpc`, forwards the API's calls to each backend (`WIDGET_PLUGIN_BACKENDS` names the gateway, for example `http://plugin-gateway:8081` for one backend), and passes from the backends only `POST /internal/plugin-broker/...` to the API, refusing everything else. On Kubernetes a network policy that allows only the broker's port and path does the same. The gateway and the egress proxy are the deployer's (decision S4); any reverse proxy and any allowlisting forward proxy will do.

```yaml
  plugin-gateway:            # the only service on plugin-rpc besides the backends
    image: <a reverse proxy the deployer configures>
    networks: [<the API's network>, plugin-rpc]
  plugin-egress:             # the backends' only way out, to the approved hosts
    image: <an allowlisting forward proxy>
    networks: [<an outside network>, plugin-egress]
```

The platform cannot stop a container it does not run. Its kill switch is to stop routing to the backend at once; the deployer stops the container.

### 5.4 Recipe B: a runner process, for single-image installs (best effort)

For deployments that cannot run sidecar containers, such as the Lite image, a separate `plugin-runner` process (its own supervisor program, not the API process) starts the backend with an unprivileged user, a private mount view, Landlock rules for the filesystem, a seccomp profile, resource limits and a socket-only listener, and reaches the network only through a local allowlisting proxy. Which layers are available depends on the kernel and on what the container may do. **The runner refuses to start a backend if any layer cannot be applied.** It is weaker than recipe A and the docs say so.

**Option C, later:** run backend logic as a WebAssembly component in a separate runner process, with filesystem and network granted by capability.

| Requirement | Recipe A | Recipe B |
|---|---|---|
| R1, R2 | A container with an unprivileged user | A child of the runner under a dropped user |
| R3 | `read_only`, tmpfs scratch, no mounts | Landlock plus a private mount view |
| R4 | Internal networks and the egress proxy | A socket-only listener and the local allowlisting proxy |
| R5 | Container limits | rlimits and cgroups where available |
| R7 | The identity check (5.5) | The runner verifies the digest before it starts the process |
| R10 | Dropped capabilities, no Docker socket | seccomp, and no privileges to give |

### 5.5 Registration and integrity

The deployer lists the backends the API may call in configuration, `WIDGET_PLUGIN_BACKENDS`: a map of plugin id to an internal URL on the private network (or a unix socket). A plugin with a backend component has no working server side until it is listed.

The API calls `GET /.workspace/identity` and expects `{ "plugin": "<id>", "version": "<version>", "digest": "<package digest>", "protocol": 1 }`. The digest must equal the digest of the version the admin approved. A mismatch stops all routing to that backend and raises an audit event.

This check catches mistakes: the wrong image, a stale image. It does not stop a hostile image from lying, because the deployer chose the image. The isolation in 5.2 is what limits a hostile backend. The deployer computes the digest to build into the image with the plugin check script (`python -m scripts.plugin_check --digest <dir>`).

### 5.6 The RPC (API to backend)

HTTP over the private network or a unix socket. Paths live under `/.workspace/` so they cannot collide with the plugin's own.

| Request | Purpose |
|---|---|
| `GET /.workspace/identity` | The identity above. |
| `GET /.workspace/health` | Liveness. |
| `POST /.workspace/routes/<route-id>` | A widget's call. Body: `{ "args": {}, "widget": { "id", "instanceId" }, "caller": { "id" } }`. Headers: `X-Workspace-Call` (5.7) and `X-Workspace-Secret-<Name>` for each secret the route declares. The response is JSON within the route's limits. |

A widget calls it through `invoke("core:backend:call", { route, args })`. Routes and their limits are declared in the manifest, and a widget names the routes it may call.

### 5.7 The broker, and why a call-context token

A backend sometimes needs data held by a Workspace backend (a data source). It must not be able to read data the calling user cannot read, or data from a source the admin did not approve. So it does not hold credentials. The API gives each call a short-lived **call-context token**: signed with a key plugins never hold, 60 seconds, carrying the plugin id, widget and instance, the user, the declared data sources and a nonce. To read a data source the backend calls the broker at `POST /internal/plugin-broker/data/<data-source-id>` with the token. The API verifies it, applies the **user's** RBAC, injects the backend's endpoint headers and returns the response.

### 5.8 What the backend learns about the user

By default nothing. With `identity: "pseudonymous"` approved, `caller.id` is a stable per-plugin value derived from the user's id with a key the plugin never holds. No email, no name, no roles.

### 5.9 Limits and failure

- Defaults, capped by deployment settings: 30 seconds per request, 5 MiB bodies, 8 concurrent calls, a per-user and a per-plugin rate limit.
- A circuit breaker: after repeated failures the API fails fast for a short period, then probes.
- A crash or a slow backend affects only its own widgets.

### 5.10 What the platform ships and what the deployer provides

| The platform ships | The deployer provides |
|---|---|
| The backend registry, the identity check, the RPC proxy with limits and the breaker, the broker and token, audit and metrics, the admin UI | The container or runner, the network policy and the egress enforcement, resource limits, the image and its build |

### 5.11 As built

- **The manifest.** `server.backend` is `{ "protocol": 1, "routes": [...] }`. A route has an `id`, `args` (the types of proxy arguments, checked by the API before anything is sent), the `secrets` it sends, and `response` limits (`maxBytes` up to 5 MiB, default 1 MiB; `timeoutMs` up to 30 seconds, default 10). A widget names its routes in `server.routes` and has `core:backend:call`, and only then. `dataSources` and `identity: "pseudonymous"` need a backend. Secrets are for proxies and routes.
- **The review** adds that code runs on the server, each route (again when it changed), each data source and the pseudonymous id, each to acknowledge. Approving records `backend`, `data_sources` and `identity`.
- **The registry** is `WIDGET_PLUGIN_BACKENDS`. The API asks a listed backend for `GET /.workspace/identity` before routing to it and holds the answer for `WIDGET_PLUGIN_BACKEND_IDENTITY_SECONDS` (60). A plugin id, version, digest or protocol that is not the active version's stops routing (`backend_mismatch`), and the start of a mismatch is recorded as a `backend-mismatch` event. A superuser checks again with `POST /plugins/{plugin_id}/backend/check` (the plugin page's Check now, `workspace-admin plugin check-backend`). Restoring a revoked plugin asks again. A digest is what `python -m scripts.plugin_check --digest` prints.
- **A call** is `POST /app/widget-plugins/{plugin_id}/backend/{route_id}` with `{"widget", "instance", "args"}`; the frame's `invoke("core:backend:call", { route, args })` makes it with its widget and instance. The API sends `POST /.workspace/routes/<route-id>` with `{"args", "widget": {"id", "instanceId"}, "caller"}`, the token in `X-Workspace-Call`, and each secret of the route in `X-Workspace-Secret-<name>`, the name's underscores as hyphens. It answers the frame with the backend's JSON. A 4xx of the backend is `backend_refused`, a 5xx `backend_error`, a non-JSON answer `unsupported_content_type`.
- **Limits.** The route's limits are capped by `WIDGET_PLUGIN_BACKEND_MAX_BYTES` (5 MiB) and `WIDGET_PLUGIN_BACKEND_TIMEOUT_MS` (30 seconds); 8 calls of a plugin at once per API process; 60 a minute per user and 600 per plugin. After `WIDGET_PLUGIN_BACKEND_BREAKER_FAILURES` (5) failures in a row (time-outs, unreachable, 5xx; not the backend's own refusals) calls fail fast for `WIDGET_PLUGIN_BACKEND_BREAKER_SECONDS` (30), then one call goes through as a probe.
- **The token** is opaque to the backend: its claims (plugin, version, widget, instance, user, entity, declared data sources, expiry in 60 seconds) are encrypted and authenticated with AES-GCM under a key derived from `WORKSPACE_AES_KEY`, which plugins never hold. A backend cannot read the user from it or change it.
- **The broker** is `POST /internal/plugin-broker/data/{data-source-id}` with the token in `X-Workspace-Call` and `{"path", "method" (GET or POST), "query", "body"}`. An organization's admin maps each declared data source to one of the organization's backends (`data_sources` in `PUT /admin/plugins/{plugin_id}`, the Data sources section of the plugin's card). The broker checks the token, that the plugin is still available to the user in the same version (so revoking stops reads with tokens already given out), that the data source is declared and mapped, and that the user may read that backend as the app lets them (their own, their organization's on an on-premise deployment, or one a role of theirs gives access to). It sends the request to a path under the backend's URL, never another host, with the backend's credentials in the headers or query where the backend declares them, and returns the status, type and body. The credentials never leave the API.
- **What the backend learns** is nothing of the user, or with `identity: "pseudonymous"` approved, `caller.id`: an HMAC of the plugin id and the user id under a derived key, stable per plugin.
- **Logs and metrics.** One line per call and per broker read, without arguments, bodies or secrets; `widget_plugin_backend_calls_total`, `widget_plugin_backend_call_seconds`, `widget_plugin_backend_identity_checks_total` and `widget_plugin_broker_calls_total` (DESIGN 11).
- **Tests.** `tests/test_widget_plugin_backends.py` against a stand-in backend and a stand-in data source on 127.0.0.1: the manifest rules, the token, the breaker, the review, every refusal, identity mismatches, time-outs, the broker's access rules, credentials and path rules, and the entity's mapping. `frontend/tests/e2e/plugin-backends.spec.ts` on the compose stack: the frame calls a route, the backend on the host reads the organization's data source through the broker, the data source gets its key, and neither the frame nor the backend sees it; another digest stops the calls.
- **Not shipped** (decision S4 and 5.10): the container or runner, the gateway, the egress proxy and the image build. Recipe B's runner is not built: the spike found that a container with the default privileges cannot give a backend a private mount view (SPIKE).

## 6. Network hosts, two kinds

| Kind | Governs | Declared in | Enforced by |
|---|---|---|---|
| Frame | What the browser may contact directly from the frame | `csp` | The browser (SECURITY 4) |
| Server | What the API's proxies and the plugin backend may contact | `server.network` | The API's checks (3.3) for T1. For T2, an egress point the deployer runs, and for a `tcp://` endpoint the network the deployer gives the backend. |

`server.network` uses the same validator as the CSP sources (https only, no IP literals or private hosts without a confirmation, no wildcards broader than two labels). The superuser approves, edits or overrides it; an entity admin can only narrow it. Prefer a proxy over a `connect-src` host when the call carries a secret or returns data the plugin should not see in the clear in the browser's network panel.

A plugin with a backend may also list `tcp://host:port` endpoints: what its backend opens that is not HTTPS, such as a database. The port is named, there is no wildcard, and the host follows the same rules, so a private name or an IP address needs a superuser's override with `private-host`. The API never calls them; the deployer's egress for the backend allows them, typically a network that holds only that service. A database's host belongs to the deployment, not the package, so it usually arrives through the superuser's override rather than the author's list.

As built. The list is https origins (no path), and for a plugin with a backend `tcp://host:port` endpoints, checked by `check_network` in `api/widget_plugins/proxy.py` and `checkNetwork` in `frontend/src/plugins/csp.ts`, which run the `network` cases of `csp-cases.json`. A proxy's host must be on the declared list. Approving a version records its list. `PUT /plugins/{plugin_id}/overrides` takes `server_network` beside `csp`; the override is replaced whole, and a superuser's list replaces the declared one (`widget_plugin.overrides["server_network"]`). A private name or an IP address in it needs `private-host`, and `private-host` given with a `server_network` override also lets the listed names resolve to private addresses: without it, a call to a name that resolves privately is refused, which covers split-horizon names an author can declare. An entity admin removes hosts with `server_network_narrow` (`PUT /admin/plugins/{plugin_id}`); a host added to the approved list later is allowed unless removed. The review lists each host (`server:<origin>`), each proxy (`proxy:<id>`, again when its template changed) and each secret (`secret:<name>`) to acknowledge.

## 7. Open decisions

| # | Decision | Recommendation |
|---|---|---|
| S1 | Are plugin backends in v1? | No. T0 and T1 in v1, T2 in the next release. T2 needs infrastructure choices (S3) and the riskiest review. Built on this branch all the same (5.11); shipping it is still this decision. |
| S2 | Where secret values come from | Both: deployment configuration, and write-only entry by a superuser. Configuration wins. Built: a secrets directory (section 4). |
| S3 | The T2 baseline | Recipe A. Recipe B for Lite, documented as weaker. The spike confirmed recipe A, with the gateway of 5.3; recipe B cannot apply all its layers in a default container (SPIKE). |
| S4 | Who runs the egress enforcement for T2 | The deployer, from the list the UI shows. The platform does not ship a forward proxy in v1. |
