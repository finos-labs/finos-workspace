# Widget plugins: security

Status: proposal, 2026-10-09.

Files: [README](README.md) · [DESIGN](DESIGN.md) · [GUEST-CONTRACT](GUEST-CONTRACT.md) · [WIDGETS-JSON](WIDGETS-JSON.md) · [SERVER-SIDE](SERVER-SIDE.md) · **SECURITY** · [PLAN](PLAN.md) · [SPIKE](SPIKE.md) · [AUTHORING](AUTHORING.md)

## Contents

1. [Threat model](#1-threat-model)
2. [Two enforcement planes](#2-two-enforcement-planes)
3. [Sandbox layers](#3-sandbox-layers)
4. [The CSP model: declared by the author, overridden by the admin](#4-the-csp-model-declared-by-the-author-overridden-by-the-admin)
5. [Frame lifecycle and the canary](#5-frame-lifecycle-and-the-canary)
6. [Residual risks](#6-residual-risks)
7. [Abuse cases and their tests](#7-abuse-cases-and-their-tests)
8. [Alternatives considered](#8-alternatives-considered)
9. [Existing code that is not reused](#9-existing-code-that-is-not-reused)
10. [To verify in the spike](#10-to-verify-in-the-spike)
11. [The install path](#11-the-install-path)
12. [Responsibility](#12-responsibility)

## 1. Threat model

**Assets.** The user's session token and the deployment's service token (the SPA holds both). The integrity of the Workspace UI. The data of other widgets and other plugins. The user's browser network position, which can reach an intranet. The API, called as the user. Plugin secrets. The deployment's own files and network: its database, cache, storage and other services.

**Attacker.** The plugin's code. It may be malicious from the start, compromised later through its supply chain, or exploited through the data it renders (HTML in a cell value, for example). The design assumes arbitrary JavaScript execution inside the frame, and for a plugin backend arbitrary code in its process. A second attacker is anyone holding an admin web session (stolen, hijacked through XSS or CSRF): section 11 is about them.

**Out of scope.** Browser engine, container runtime and kernel vulnerabilities. A compromised host SPA or API. The deployer, who chooses what goes on the server. An admin who approves everything: mitigated by a legible trust summary, closed defaults and audit, not by code.

**The boundary, stated plainly.** The sandbox protects the host and everything else on the page. It does not stop a plugin from misusing the data it was given to render. That is bounded by giving each frame only its own widget's data, by the egress allowlist an admin approves (section 4), by checksum pinning, and by the review and audit around enabling. Nothing here makes a plugin safe (section 12).

## 2. Two enforcement planes

| Plane | Enforced by | Set | Covers |
|---|---|---|---|
| Browser | iframe `sandbox` flags and the CSP | Once, when the frame is created. The guest cannot change either. | DOM and storage access, popups, navigation, and **direct network access**. |
| Host | The runtime authority, on every message | Per call | What the frame asks the host to do with the user's credentials: data, params, state, links, clipboard, downloads. |
| Server | The API's checks (RBAC, the outbound guard, budgets) and, for a plugin backend, the container or runner settings | Per call, and at deployment | Credentials, the deployment's files and network, what a proxy or a backend may reach. See SERVER-SIDE. |

Tauri has the same split: the webview CSP on one side, command permissions and scopes on the other. A CSP-allowed host is not a permission the authority can check, so the admin's approval of the CSP is the decision about network egress.

## 3. Sandbox layers

1. **Browsing context.** `<iframe sandbox="allow-scripts">` and nothing else. The frame gets an opaque origin: no access to the parent DOM, `localStorage`, `sessionStorage`, IndexedDB or cookies, and its requests carry `Origin: null`. Never granted: `allow-same-origin`, `allow-top-navigation*`, `allow-popups*`, `allow-forms`, `allow-modals`, `allow-downloads`, `allow-pointer-lock`, `allow-presentation`, `allow-orientation-lock`, `allow-storage-access-by-user-activation`. Sandbox flags are inherited by nested frames.
2. **CSP floor.** Directives no one can override (section 4): `default-src 'none'`, `base-uri 'none'`, `object-src 'none'`, `form-action 'none'`. Network is closed unless a policy opens it.
3. **No ambient authority.** The session token and the service token never enter the frame. Every authenticated call is made by the host. A frame has no storage to read credentials from, and any request an approved policy lets it make carries no credentials (opaque origin). Plugin secrets are injected on the server and never sent to the browser (SERVER-SIDE 2 and 4).
4. **Verified code.** The host fetches the bundle with the user's credentials and checks each file's SHA-256 against the digest the admin approved. The shell evaluates the bytes through a Blob URL. Versions are immutable. This guarantee covers only code the host delivered: a remote `script-src` origin in the policy lets code in that is not covered, which is why section 4 rates it critical.
5. **Private channel and identity.** One `MessageChannel` per frame. The port is handed over only to the window that announced itself (`event.source` is the frame's `contentWindow`). Apart from that one announcement, the host ignores window-level `message` events from frames. Identity is the port, never a field in a message. Every message is validated against a Zod schema.
6. **Fail-closed canary.** Before any plugin byte is sent, the shell proves that the opaque origin and the CSP are in force (section 5). Any failed check means no code is delivered.
7. **Containment.** One frame per instance, so no shared realm. Budgets, proposed and configurable: a guest-to-host message at most 1 MiB; 100 messages per second sustained with a burst of 200; at most 32 pending commands; three protocol violations in ten seconds end the frame and write an audit event. A watchdog pings every 5 seconds while the frame is visible and removes it after three missed replies. At most 24 frames per dashboard before a warning. Frames are created lazily and released when far from the viewport or on an inactive tab.
8. **UI integrity.** A frame cannot draw outside its rectangle. Host chrome never renders plugin-supplied HTML. Notifications from a plugin are plain text, rate limited, labelled with the plugin's name. Links go through the existing external-link confirmation. No popups.

## 4. The CSP model: declared by the author, overridden by the admin

### 4.1 Who decides what

| Who | May |
|---|---|
| Plugin author | Declare `csp`, with a reason per directive in `cspNotes`, in the manifest. A declaration is a request and does nothing until approved. |
| Superuser (the Workspace admin) | Approve the declared policy, edit it, or replace it (override), widening or narrowing, per plugin. Bounded by the validator and the floor. |
| Entity admin | Narrow only: remove sources for the entity. Never widen. |
| Platform | Owns the floor, appends the shell's hash and `blob:`, validates every policy and composes the final string. |
| User | Nothing. |

On a single-organization deployment the seeded administrator is a superuser, so the Workspace admin is the person who approves and overrides. Whether entity admins may also widen is a decision in the README.

### 4.2 Shape

A policy is an object of directive to a list of sources, the object form Tauri's CSP configuration uses. Raw policy strings are never accepted from authors or admins: the server composes the final string from validated parts, so nothing can be injected into the policy or into the `<meta>` attribute.

```jsonc
"csp": {
  "connect-src": ["https://<host>", "wss://<host>"],
  "img-src":     ["data:", "blob:", "https://<host>"],
  "font-src":    ["data:", "https://<host>"],
  "media-src":   ["https://<host>"],
  "style-src":   ["'unsafe-inline'"],
  "script-src":  ["'wasm-unsafe-eval'", "'unsafe-eval'", "'sha256-<base64>'"],
  "worker-src":  ["blob:"],
  "frame-src":   ["https://<host>"]
},
"cspNotes": { "connect-src": "<why the plugin needs this host>" }
```

| Directive | Author may request | Admin may override |
|---|---|---|
| `connect-src`, `img-src`, `font-src`, `media-src`, `style-src`, `script-src`, `worker-src`, `frame-src` | yes | yes |
| `default-src`, `base-uri`, `object-src`, `form-action`, `frame-ancestors`, `sandbox`, `report-uri`, `report-to`, `navigate-to` | no: platform-owned | no |

### 4.3 Source rules

One validator, implemented twice (TypeScript in `plugins/csp.ts`, Python in `api/plugin_discovery.py`) and tested with the same cases. It runs on the manifest at discovery, on every override, on every narrowing and on every report-driven "Allow".

| Rule | Author | Superuser override |
|---|---|---|
| `'none'` (alone), `data:`, `blob:` | accepted | accepted |
| `https://host[:port][/path/]`, `wss://host` (`connect-src` only); host is a lowercase DNS name, or `*.` plus a name with at least two labels | accepted | accepted |
| `'unsafe-eval'`, `'wasm-unsafe-eval'` in `script-src`; `'unsafe-inline'` in `style-src`; `'sha256-...'`, `'sha384-...'`, `'sha512-...'` hashes in `script-src` and `style-src` | accepted | accepted |
| `http://`, `ws://` | rejected | only with the confirmation `insecure-scheme` |
| IP literals, `localhost`, single-label names, `.local` and `.internal` names (the browser can reach the intranet) | rejected | only with `private-host` |
| A remote host in `script-src` (code that can change after approval) | rejected | only with `remote-script` |
| `'self'` (in a `srcdoc` frame it can resolve to the Workspace origin, and browsers differ), bare `*`, scheme-only sources such as `https:`, `'unsafe-inline'` in `script-src`, `'strict-dynamic'`, `'unsafe-hashes'`, nonces | rejected | rejected |
| Credentials, query or fragment in a URL; whitespace, commas, semicolons, quotes, `<`, `>`, `&`; non-ASCII hosts (punycode only); more than 32 sources in a directive | rejected | rejected |

A confirmation is a field in the request body and a typed acknowledgement in the UI. It is stored in the audit event.

### 4.4 Risk

| Policy content | What it permits | Risk |
|---|---|---|
| Nothing beyond the floor | No network at all | none |
| `'wasm-unsafe-eval'` | WebAssembly compilation | low |
| `'unsafe-eval'` | String to code, so injected markup can run code in the frame | medium |
| `img-src`, `font-src`, `media-src` host | Reads from the host, and a channel out: a request URL can carry data | medium |
| `connect-src` host | A full request and response channel: the plugin can send anything it holds | high |
| `frame-src` host | A nested page of that host, with the sandbox flags inherited | high |
| Remote `script-src` host | Code that can change after the digest was approved | critical |
| `http://`, IP or private host | Plaintext, or reach into the intranet | critical |

The approval screen leads with an egress summary: "This plugin can send the data it displays to: ..." listing every host in any directive.

### 4.5 Composition

```
FLOOR (always):
  default-src 'none'; base-uri 'none'; object-src 'none'; form-action 'none'
  script-src  'sha256-<the shell's script>' blob:
  style-src   'unsafe-inline' blob:
  img-src     data: blob:
  font-src    data: blob:
  media-src   data: blob:
  worker-src  blob:
  connect-src 'none'

approved[d] for a plugin version =
    plugin.csp_override[d]    if the plugin has an override for d   (an empty list means nothing)
    else declared[d]          if the version's policy is approved
    else nothing              (an unapproved request is inert)

narrowed[d] for an entity =
    approved[d] restricted to the sources the entity allows, when the entity narrows d

effective[d] = FLOOR[d] plus narrowed[d]        ('none' is dropped when a source is added)
```

Worked example, with placeholders for hosts:

| Layer | `connect-src` | `img-src` |
|---|---|---|
| Floor | `'none'` | `data: blob:` |
| Author declares | `<api-host>` | `<tile-host>` |
| Superuser overrides `connect-src` with an empty list and accepts the rest | none | `<tile-host>` |
| Entity admin narrows `img-src` to nothing | none | none |
| Effective for that entity | `'none'` | `data: blob:` |

The API computes the final string for the signed-in user's entity and returns it in `GET /app/widget-plugins`. The host never merges policies.

### 4.6 Delivery

The host builds the shell as a string and sets it as the frame's `srcdoc`. The policy is a `<meta http-equiv="Content-Security-Policy">` that is the first element in `<head>`:

```html
<!doctype html><html><head>
<meta http-equiv="Content-Security-Policy" content="…the effective policy…">
<meta http-equiv="x-dns-prefetch-control" content="off">
<meta name="referrer" content="no-referrer">
<meta charset="utf-8">
</head><body><div id="root"></div><script>/* the shell; its hash is in script-src */</script></body></html>
```

The iframe is `sandbox="allow-scripts" referrerpolicy="no-referrer"` with a `title` and no `allow`.

Why a `srcdoc` and a meta policy: the policy differs per plugin and per entity, and only a response header can otherwise carry a policy. A header would need a dynamic endpoint, and an iframe navigation cannot carry the `X-Workspace-Client` header the API requires with the session cookie, so that endpoint would be unauthenticated. The shell would also have to live in the API image although it is frontend code. With `srcdoc` there is no infrastructure change: no nginx change, the same behavior in dev and compose. The `sandbox` directive is not allowed in a meta policy, so the iframe attribute provides it, and a `srcdoc` has no URL anyone could open on its own, so the "a header sandboxes the document even when opened directly" benefit does not apply.

Caveats:

1. A `srcdoc` document inherits the embedding page's CSP. The SPA sets none today (checked: `frontend/nginx.conf` and `index.html` carry no CSP or framing header). If an operator adds one, plugin policies are intersected with it, and it must allow `blob:` and `data:` for frames. This goes in the operator docs.
2. A meta policy cannot carry `report-uri` or `frame-ancestors`. Reporting uses the violation event (4.7).
3. The policy applies from the point the meta element is parsed, which is why it comes first.
4. Whether removing the meta element at runtime lifts the policy is checked in the spike (the spec says no).

**Header route (optional hardening, later).** Serve the shell from the API at a URL derived from the policy's hash with the same string as a real header, plus `sandbox allow-scripts` and `frame-ancestors`. That adds defense in depth and a path to a dedicated origin. It costs an unauthenticated endpoint, a shell inside the API image and coupling to the SPA origin. The decision is in the README.

### 4.7 Observing violations

The shell listens for `securitypolicyviolation`. It reduces each event to a directive and an origin (scheme and host of the blocked URL, or a keyword: inline, eval, data, blob), de-duplicates in the frame and sends it over the port. Everything after the canary is reported, what the plugin does while it initializes and renders included; the canary's own probes are not. A worker reports in its own global scope, so every worker the plugin starts from a `blob:` or `data:` URL first runs a few lines of the shell that hand its trusted violation events to the shell on a private port, and so do the workers it starts; a `data:` worker stays a `data:` URL, so the policy decides about it as before. WebKit raises no violation event in a worker (and none for a refused `eval`), so there it reports nothing; the requests are refused all the same (SPIKE). The host batches reports to `POST /app/widget-plugins/report`. The API stores counts in `widget_plugin_csp_report`, 30 days.

The plugin page shows **Blocked requests** per directive and origin, with an **Allow** action that opens the override editor with that source filled in. The validator checks it again; a superuser confirms. Entity admins see their entity's feed.

The origins are attacker-controlled: a hostile plugin can invent origins that encode data. They are capped (200 distinct per plugin, 255 characters each), ignored when they are not valid origins, deduplicated, and rendered as text.

As built. The shell reports only events the browser raised (`isTrusted`): plugin code can dispatch a `securitypolicyviolation` of its own, with any blocked URI and directive, and that is not reported. Reports also count against the frame's message budget, so a flood loses some on the way and earns protocol violations. The host sends at most 50 reports a request, every five seconds, and sends what is left when the frame goes; a page that unloads first loses the reports not yet sent. Abuse case 25 runs in Playwright (`tests/e2e/plugin-admin-journey.spec.ts`): forged events with markup and requests to 250 origins reach the superuser's feed as at most 200 origins, none forged, rendered as text.

### 4.8 Updates

The author's policy belongs to a version. A new version never activates on its own: the active version keeps serving until a superuser approves the new one. Its declared policy is compared per directive with the active version's approved policy, the diff shows every source added or removed, and each added source needs its own acknowledgement. An override belongs to the plugin and persists across versions: a directive with an override ignores the new author's list for that directive, and the diff shows it.

## 5. Frame lifecycle and the canary

1. `PluginWidget` mounts. The registry supplies the plugin, digest, effective permissions and effective CSP.
2. The host builds the shell `srcdoc` (4.6) and creates the iframe.
3. The shell runs and posts `ws-shell-ready` to its parent. It carries nothing sensitive.
4. The host checks `event.source === iframe.contentWindow`, creates a `MessageChannel` and transfers `port2` to that window (`targetOrigin "*"`, because an opaque origin has no name).
5. The shell takes the port and runs the **canary**, then sends `hello { runtime, afm, canary }` over it.
6. The host verifies that every canary check passed **and** that it cannot read `iframe.contentDocument`. Otherwise it fails closed and sends nothing.
7. The host fetches the bundle files with credentials (cached by digest in memory), checks each SHA-256 against the listing, and fails on any mismatch.
8. The host sends `load` with the entry bytes, styles, assets, the initial model state and the effective permissions.
9. The shell evaluates the module and runs `initialize` then `render` (GUEST-CONTRACT 2). It reports `loaded` or `error`.
10. Running: pushes, writes, commands, exports, `ping` and `pong`.
11. Dispose: `dispose`, abort, cleanup, remove the iframe, close the port.

**Canary checks**, all in the shell before any plugin byte exists in the frame:

- `localStorage`, `sessionStorage`, `indexedDB.open` and `document.cookie` throw `SecurityError`: the origin is opaque.
- `window.parent.document` throws.
- For every directive the effective policy **denies**, a harmless probe is attempted and a `securitypolicyviolation` event for that directive is expected: `fetch` and an image to a reserved `.invalid` host, a `<link rel=stylesheet>` to it, `new Function("return 1")` when eval is not approved, an inline script. A reserved host never resolves and the URL carries no data, so even a missing policy leaks nothing. A missing violation event means the policy is not enforced.

A failed check names itself in the admin-facing message, for example "the frame's CSP was not applied", so an operator can find a proxy or a browser setting that interferes.

## 6. Residual risks

1. **Exfiltration of what the plugin is given.** With the default policy, a frame can still navigate itself to a URL that carries data, and DNS or resource prefetch is not governed by `connect-src` ([Chalmers study](https://research.chalmers.se/en/publication/?id=237715)). Measured (SPIKE, check 9): `prefetch` and `preload` are refused by the policy in every engine, but a frame's `preconnect` is looked up in DNS in Firefox and WebKit, and its `dns-prefetch` in WebKit, whatever the policy and the `x-dns-prefetch-control` meta say; WebRTC is also outside it, and no CSP directive stops a frame navigating itself with reliable cross-browser support. Mitigations: only this widget's data enters the frame; `x-dns-prefetch-control` off and `no-referrer`; the host treats an unexpected second `load` of the iframe as navigation, removes the frame and writes an audit event (the request may already have gone out); and the admin's trust decision about the package. With an approved `connect-src` or `img-src` host the channel is direct and the approval is the control.
2. **Hostile CPU or memory.** The watchdog can remove a frozen frame only while the host's thread runs. Whether a browser process-isolates an opaque-origin frame varies. If it does not, a busy loop slows the tab. Checked in the spike; a dedicated origin (the header route) is the stronger answer.
3. **Misleading content** inside the frame's own rectangle. The host labels the card with the plugin's name.
4. **A mistaken approval.** Mitigated by the egress summary, risk labels, deny-by-default, narrowing and audit.
5. **A plugin that was approved and is hostile** can misuse the data it renders and the permissions it was given. Digest pinning ties execution to what was approved, not to what is safe. Signed packages and trusted publishers are a later phase.
6. **Browser engine bugs.** Out of scope.
7. **A hostile package placed by the deployer.** Not an attack on the deployment, but pins (`WIDGET_PLUGINS_PINS`, `WIDGET_PLUGINS_REQUIRE_PINS`) detect later tampering, and the admin's review is the control before anything is enabled.
8. **A hostile plugin backend.** Limited by the requirements in SERVER-SIDE 5.2. A container runtime or kernel escape is out of scope, and the platform cannot stop a container it does not run (SERVER-SIDE 5.3).
9. **Secrets in a backend.** A backend that receives a secret can misuse it, within the hosts it may reach. Proxies (T1) keep the secret out of plugin code entirely, so prefer them.

## 7. Abuse cases and their tests

A hostile test package, **generated by the test itself** into a temporary directory and never committed as a plugin, attempts each of these. Rows 1 to 19, 25 and 38 run in Chromium, Firefox and WebKit through Playwright. Row 37 is a Vitest case. Rows 20 to 24 and 26 to 36 are pytest and compose integration tests.

| # | Abuse | Defense | Expected result |
|---|---|---|---|
| 1 | Read `parent.document`, `top.document`, `window.opener` | Opaque origin | `SecurityError` |
| 2 | Read `localStorage`, `document.cookie`, `indexedDB` | Opaque origin | `SecurityError` |
| 3 | `fetch`, XHR, WebSocket, EventSource, `sendBeacon` to the API origin or any host | CSP | No request in the network log; a violation event |
| 4 | Image, CSS `url()`, `<link>` or `@import` beacons | CSP | Same |
| 5 | `window.open`, `top.location =`, form submit, `alert` | Sandbox | Blocked |
| 6 | Navigate the frame itself | Host detects a second `load` | Frame removed, audit event (residual 1) |
| 7 | `postMessage` to the parent with forged host messages | Host ignores window messages | No effect |
| 8 | Two frames: one claims the other's identity | Identity is the port | Authority uses the port's instance |
| 9 | Commands without permission, or out of scope (undeclared param, oversize state, `javascript:` link) | Authority | Refused with a code; a rejected write is echoed back |
| 10 | Flood: 10k messages per second, a 100 MB message, deep nesting | Budgets | Frame ended, host responsive |
| 11 | Infinite loop or memory bomb in `render` | Watchdog | Frame removed, other widgets unaffected |
| 12 | Modified bundle bytes served | Digest check | Not delivered |
| 13 | Shell without its CSP meta | Canary | No code delivered |
| 14 | Remove the meta element at runtime | Policy persists | Still enforced (spike) |
| 15 | Remote script import | CSP | Blocked; allowed only with an override, with a warning shown |
| 16 | `eval` or `new Function` without approval | CSP | Blocked, violation event |
| 17 | Prototype pollution, global overwrites in the frame | Separate realm | No effect on the host |
| 18 | Markup or very long text in `core:ui:notify` | Plain text, cap | Rendered as text, truncated |
| 19 | `open-link` with `javascript:`, `data:`, `http:` | Authority | Refused |
| 20 | Discovery: symlinks, paths outside the directory, over-cap file counts or sizes, odd names, a manifest whose id or version differs from its directory (pytest) | Discovery pipeline | Blocked with a reason |
| 21 | Manifest or override CSP with `;`, quotes, newlines, `'self'`, `*`, scheme-only (pytest, Vitest) | Validator | Rejected |
| 22 | Override with `http://`, a private host or a remote script and no confirmation | Validator | Rejected |
| 23 | A new version that asks for more permissions or a wider CSP | Explicit approval, with a diff | Old version keeps serving |
| 24 | Entity admin tries to approve a version, set an override or widen the CSP | Authorization | 403 |
| 25 | Blocked-origin feed filled with markup or thousands of origins | Caps and escaping | Rendered as text, capped |
| 26 | A hijacked admin session tries to deploy code: upload, fetch from a URL, write a file | No such endpoint; the API only reads the plugins directory | No route exists (pytest asserts the route table); the directory is read-only in the test stack |
| 27 | Edit `entry.js` in place after approval | Digest check on read; the host verifies again | Version blocked as changed; frames never receive the modified bytes |
| 28 | A new version appears in the directory | Updates need an explicit approval | The active version keeps serving; nothing activates on its own |
| 29 | A newly discovered plugin | Disabled by default | Not served, not listed to users |
| 30 | Proxy abuse: `${arg}` in the host, a redirect to a private address, DNS rebinding, a metadata address | Template rules and the outbound guard | Refused; no request sent |
| 31 | Reading a secret from the frame: a trait, an error message, a header echo | Secrets exist only in server memory and the outbound request | Nothing in the frame; no secret in any response, log or report |
| 32 | A backend reads the deployment's environment or files, other plugins' directories, the database, the cache or the API's other endpoints | Container or runner settings (SERVER-SIDE 5.2) | Denied; compose integration tests |
| 33 | A backend reads data the calling user may not read, or from an undeclared source | Call-context token and the broker's RBAC | Denied |
| 34 | A backend image that does not match the approved version | Identity check | Routing stops; audit event |
| 35 | A backend exhausts CPU, memory or the process table, or hangs | Limits and the breaker | Contained to that backend |
| 36 | A user calls a proxy or route of a plugin that is not available to them | Availability check on every call | 404 |
| 37 | A widget of one backend names another backend's MCP server and tool, to have that backend's results cited as its own (WIDGETS-JSON 5) | The reference resolves only against the servers the widget's own backend declared, by the backend's id and the declared name | No match, no citation; the reference is reported when the backend loads |
| 38 | A plugin frame tries to read a widget's `mcp_tool` link or to call the linked tool | The link is host-only: no binding, no command, no permission | `unknown_command` or `not_granted`; nothing in any trait |

## 8. Alternatives considered

| Option | DOM isolation | Works for DOM-heavy libraries (grids, charts) | Verdict |
|---|---|---|---|
| Same-realm dynamic import (module federation) | none | yes | Rejected. |
| `srcdoc` iframe with `allow-scripts allow-same-origin` (what `HtmlViewer` does) | none: the framed page can reach the parent and remove its own sandbox | yes | Rejected. |
| In-page realm sandbox ([Grafana's frontend sandbox](https://grafana.com/docs/grafana/latest/administration/plugin-management/plugin-frontend-sandbox/), a preview that proxies the DOM) | partial | fragile | Rejected for v1. |
| Web Worker with a host-rendered UI tree ([Shopify's remote rendering](https://shopify.engineering/remote-rendering-ui-extensibility)) | strong | no: no real DOM or canvas | A later tier for declarative widgets. |
| Opaque-origin sandboxed iframe, `MessageChannel`, CSP | strong | yes | **Chosen.** |
| The same on a dedicated origin | strong, and process isolation in browsers that offer it | yes | Optional hardening. |

## 9. Existing code that is not reused

- `HtmlViewer` (`frontend/src/components/Widgets/custom/HtmlViewer.tsx:366`) uses `IFRAME_SRCDOC_SANDBOX_ATTRIBUTES`, which is `allow-scripts allow-forms allow-downloads allow-popups allow-same-origin` (`frontend/src/lib/constants.ts:555`), on a `srcDoc`. A `srcdoc` frame with `allow-same-origin` shares the parent's origin, so with `allow-scripts` its page can reach the parent and remove the sandbox. The code comments call it intentional trusted content, and `allowHtmlJsExecution` is off by default. This is not isolation, and nothing in this design builds on it.
- `Iframe.tsx` and `useIframeProtocol.tsx` recognize a sender by its window or its origin, so two copies of one page can answer for each other (`useIframeProtocol.tsx:60`). They have no permissions and no version. And they answer the page's handshake with `workspace-auth`, which sends the page the backend's credential headers and, when the deployment enables them, the user's SSO ID-token headers (`useIframeProtocol.tsx:125`). The comparison with AFM is in GUEST-CONTRACT 1.1.

Both stay as they are. The plugin runtime shares no code with them.

## 10. To verify in the spike

Each of these is expected from the specifications but has not been run here.

1. `srcdoc` with `sandbox="allow-scripts"` and a meta CSP: the policy applies and the inline shell runs through its hash.
2. `import()` of a Blob URL created inside an opaque-origin `srcdoc` frame, with `script-src blob:`, in Chromium, Firefox and WebKit. (Anywidget's own loader does the same in a normal page.)
3. A `securitypolicyviolation` event fires for each canary probe in all three engines.
4. Removing the meta element does not lift the policy.
5. A `srcdoc` frame inherits the embedding page's CSP, as 4.6 caveat 1 assumes.
6. A port transferred with `targetOrigin "*"` reaches an opaque-origin frame.
7. Clipboard write through the host after a click inside the frame.
8. Which browsers process-isolate the frame, and what twenty frames that each load a large bundle cost in memory and time.
9. The `x-dns-prefetch-control` meta is honored.

For the server side (the Phase 6 spike):

10. The container settings of SERVER-SIDE 5.3 satisfy R1 to R5 and R10 in the compose stack: a probe backend attempts each forbidden action and the results are recorded.
11. Compose internal networks leave a plugin backend no route to MySQL, Redis or the outside, and an egress proxy lets only the approved hosts through.

## 11. The install path

A plugin runs in every user's browser and, with a backend, on the server. If the app could install code, a stolen admin session, an XSS flaw in the admin UI or a CSRF flaw would be a way to deploy it. So the app never installs code, for anyone: no upload, no fetch from a URL, no endpoint that writes plugin files. Plugins reach a deployment through the plugins directory, the image, or configuration, all controlled by whoever deploys it (DESIGN 4.1).

What follows from that:

- The API mounts the directory read-only, and the test stack checks that no route can write to it (abuse case 26).
- A hijacked admin session can enable or scope a plugin that is already on the server. It cannot add one. Enabling needs the trust summary's acknowledgement, which is audited, and typed confirmations for the critical items.
- Pinning ties the approved code to a checksum that was chosen outside the app.
- The plugins directory is a deployment asset. The deployer protects it as they protect the image and its volumes.

## 12. Responsibility

Workspace limits what a plugin can reach and tells the admin what it asks for. It does not make a plugin safe, and nothing in the product, the UI or these documents says that a plugin is safe or verified. `publisher` is a claim. The trust summary says so, and the admin acknowledges that the decision to trust the plugin is theirs.

For admins, the practical rules are: read the requests before enabling; prefer plugins that ask for little (T0 over T1 over T2); pin checksums in production; scope a plugin to the roles that need it; and watch the blocked-requests feed.
