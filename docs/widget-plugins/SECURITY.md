# Widget plugins: security

Files: [README](README.md) · [AUTHORING](AUTHORING.md) · [WIDGETS-JSON](WIDGETS-JSON.md) · **SECURITY**

What the plugin runtime defends, how, and which tests check it.

## 1. Threat model

**Assets.** The user's session (an HttpOnly cookie, which page script cannot read, sent by the browser with the host's requests). The integrity of the FINOS Workspace page. Other widgets' data. The user's browser and its network position, which can reach an intranet. The API, called as the user. Plugin secrets. The deployment's own files and network: its database, cache, storage and other services.

**Attackers.** A plugin's code: malicious from the start, compromised later through its supply chain, or exploited through the data it renders. The runtime assumes arbitrary JavaScript in the frame and, for a backend, arbitrary code in its process. And anyone holding an admin's web session (section 9).

**Out of scope.** Browser engine, container runtime and kernel bugs. A compromised FINOS Workspace web app or API. The deployer, who chooses what goes on the server. An admin who approves everything: the review, closed defaults and the event log are the mitigation.

**The boundary.** The sandbox protects the host and everything else on the page. It does not stop a plugin from misusing the data it was given to render: that is bounded by giving each frame only its own widget's data, by the network the admin approves (section 3), by digest pinning, and by the review before enabling. Nothing here makes a plugin safe (section 10).

## 2. Three layers

| Layer | Enforced by | Covers |
|---|---|---|
| Browser | The iframe's `sandbox` and the frame's Content Security Policy, set when the frame is created | Page and storage access, popups, navigation, and the frame's own network access |
| Host | The runtime authority (`frontend/src/plugins/authority.ts`), on every message | What the frame asks the host to do: data, params, state, links, clipboard, downloads, proxy and backend calls |
| Server | The API's checks (availability, permissions, the outbound guard, limits) and, for a backend, the isolation the deployer gives it | Credentials, secrets, the deployment's files and network, what a proxy or backend may reach |

As in Tauri, the frame's policy and the command permissions are separate: a host the policy allows is not something the authority can check, so approving the policy is the decision about the frame's network.

## 3. The frame

- **Sandbox.** `<iframe sandbox="allow-scripts" referrerpolicy="no-referrer" srcdoc="...">` and nothing else. The frame has an opaque origin: it cannot reach the parent page, has no `localStorage`, `sessionStorage`, IndexedDB or cookies, and its requests carry `Origin: null`. It is never given `allow-same-origin`, popups, top navigation, forms, modals or downloads.
- **Private channel.** The host answers only the `ws-shell-ready` message whose `event.source` is the frame's own window, and hands that window one end of a `MessageChannel`. After that the frame talks only over its port; the host ignores window messages, identifies the caller by its port, never by a field in a message, and validates each message against a schema (`protocol.ts`).
- **No ambient authority.** The session never enters the frame. The host makes every authenticated call; a request the policy lets the frame make carries no credentials. Secrets stay on the server.
- **Verified code.** The host fetches the plugin's files with the user's session, checks each SHA-256 against the approved digest, and sends the bytes into the frame, which evaluates them from a `blob:` URL. A remote `script-src` origin, which only a superuser can add, lets in code this does not cover.
- **Budgets.** A message from the frame is at most 1 MiB; about 100 messages a second, in bursts of 200; at most 32 commands waiting. Three violations in ten seconds end the frame. The host pings every 5 seconds and ends a frame that misses three pings. A second `load` of the iframe means it navigated itself, and ends it.
- **Lazy frames.** A plugin widget's frame is created when its card nears the viewport and released when it is scrolled far away or its tab is not active.
- **The page.** A frame draws only inside its card. Notices from a plugin are plain text, rate limited and labelled with the plugin's name; links go through the external-link confirmation.

## 4. The frame's policy

### 4.1 Who decides

| Who | May |
|---|---|
| Plugin author | Declare `csp`, with a reason per directive in `cspNotes`. A declaration does nothing until a superuser approves the version. |
| Superuser | Approve the declared policy, or override it per directive, wider or narrower, within the rules below. |
| Organization admin | Remove sources for the organization. Never add. |
| FINOS Workspace | Owns the floor, adds the shell's hash, validates every policy and composes the final one. |

### 4.2 Directives

A policy is an object of directive to sources; a raw policy string is never accepted. A plugin may ask for `connect-src`, `img-src`, `font-src`, `media-src`, `style-src`, `script-src`, `worker-src` and `frame-src`. `default-src`, `base-uri`, `object-src`, `form-action` and every other directive belong to FINOS Workspace.

### 4.3 Sources

One validator in TypeScript (`frontend/src/plugins/csp.ts`) and Python (`backend-api/backend/api/widget_plugins/csp.py`), run on the same cases (`frontend/src/plugins/csp-cases.json`), at discovery and on every override and narrowing.

| Source | Author | Superuser override |
|---|---|---|
| `'none'` alone, `data:`, `blob:` | yes | yes |
| `https://host[:port][/path]`, and `wss://` in `connect-src`; a lowercase DNS name, or `*.` and a name of at least two labels | yes | yes |
| `'unsafe-eval'` and `'wasm-unsafe-eval'` in `script-src`, `'unsafe-inline'` in `style-src`, `'sha256-'`, `'sha384-'` and `'sha512-'` hashes in `script-src` and `style-src` | yes | yes |
| `http://`, `ws://` | no | with the confirmation `insecure-scheme` |
| An IP address, `localhost`, a name without a dot, or one ending in `.local`, `.internal`, `.localhost`, `.home.arpa` or `.lan` | no | with `private-host` |
| Any host in `script-src` | no | with `remote-script` |
| `'self'`, `*`, a scheme alone such as `https:`, `'unsafe-inline'` in `script-src`, any other keyword or nonce; whitespace, `,`, `;`, quotes, `<`, `>`, `&`, `\` or a backtick; non-ASCII; more than 32 sources in a directive or 255 characters in a source | no | no |

A confirmation is a checkbox in the override editor (`--confirm` in the CLI), and the confirmations given are recorded in the override's event.

### 4.4 Risk

The review leads with what the frame can send its data to, every host in any directive, and rates each directive:

| Content | Risk |
|---|---|
| Nothing beyond the floor | none |
| `'wasm-unsafe-eval'` | low |
| `'unsafe-eval'`, or a host in `img-src`, `font-src`, `media-src`, `style-src` or `worker-src` | medium |
| A host in `connect-src` or `frame-src` | high |
| A host in `script-src`; `http://`, `ws://` or an IP address anywhere | critical |

### 4.5 Composition

```
floor:
  default-src 'none'; base-uri 'none'; object-src 'none'; form-action 'none'
  script-src blob:         (the host adds the shell's sha256 hash)
  style-src 'unsafe-inline' blob:
  img-src data: blob:      font-src data: blob:      media-src data: blob:
  worker-src blob:         connect-src 'none'        frame-src 'none'

approved[d]  = the superuser's override for d if there is one, else the version's declared d
narrowed[d]  = approved[d], keeping only the sources the organization allows when it narrows d
effective[d] = floor[d] + narrowed[d]       ('none' leaves when a source is added)
```

The API composes the policy for the user's organization and returns it in the plugin list; the host does not merge policies.

### 4.6 Delivery

The host builds the frame document as a string and sets it as `srcdoc`. Its first element is `<meta http-equiv="Content-Security-Policy">`, followed by `x-dns-prefetch-control` off and `referrer` `no-referrer`, and it has exactly one script, the shell, whose hash the policy allows. A `srcdoc` frame needs no URL, server route or nginx change, and the policy can differ per plugin and organization.

- A `srcdoc` frame also inherits the FINOS Workspace page's own policy. The web app sets none; a deployment that adds one must allow `blob:` and `data:` for frames.
- A meta policy cannot carry `report-uri` or `frame-ancestors`; reports come from violation events (4.7).
- Removing the meta element at run time does not lift the policy (checked in Chromium, Firefox and WebKit).

### 4.7 Blocked requests

The shell listens for `securitypolicyviolation` events the browser raised (`isTrusted`; plugin code can dispatch its own, which are ignored), reduces each to a directive and an origin, and sends them over the port, where they count against the message budget. Every worker the plugin starts from a `blob:` or `data:` URL, and every worker those start, reports the same way; WebKit raises no violation events in workers, though it refuses the same requests. The host sends at most 50 reports every 5 seconds to `POST /app/widget-plugins/report`. The API keeps counts per plugin, organization, directive and origin for 30 days, at most 200 origins per plugin of at most 255 characters, drops what is not an origin or a keyword (`inline`, `eval`, `wasm-eval`, `data`, `blob`), and shows them as text. The superuser's Blocked requests list has an Allow action that opens the override with that source.

### 4.8 Updates

A policy belongs to a version. A new version's policy is compared per directive with the active version's, every added source needs its own acknowledgement, and the active version keeps serving until the new one is approved. An override belongs to the plugin and applies to every version.

## 5. Starting a frame

1. The host creates the frame with the composed policy and waits for `ws-shell-ready` from that frame's window.
2. It hands the frame a port. The shell runs its canary and reports the results.
3. With every check passed, the host fetches the files, verifies them, and sends them with the initial model state and the effective permissions.
4. The shell evaluates the module and runs `initialize`, then `render` (AUTHORING 4.1).

**The canary** runs before any plugin byte is in the frame. `self.origin` must be `"null"`; `localStorage`, `sessionStorage`, `indexedDB.open` and cookies must be unavailable, and `parent.document` must throw. For each directive the policy denies, a probe must raise a violation: a `fetch` and an image to a reserved `.invalid` host, `new Function` when eval is not approved, an inline script. WebKit raises no event for a refused `eval`; the `EvalError` it throws is taken as proof. A failed check sends no code, and the card shows "Plugin sandbox unavailable" with the check that failed.

## 6. The server side

- **Proxies.** A proxy is a template in the manifest: `${arg:...}` only in path segments, query values and body fields, `${secret:...}` only in header values, a literal host on the approved server network. The outbound guard (`backend-api/backend/utilities/egress.py`) resolves the name itself and refuses it when any address is loopback, private, link-local (with the cloud metadata address), shared, multicast, reserved or a documentation range, in IPv4 or IPv6, unless a superuser's override allows private hosts. It connects to the address it checked, keeping the name for `Host` and TLS, verifies the certificate, follows no redirect, and refuses a compressed answer so the size cap counts what arrives.
- **Secrets.** Write-only, encrypted at rest with `WORKSPACE_AES_KEY`, sent only in the requests that declare them, never returned, logged or put in an error.
- **Backends.** The deployer runs each backend as its own unprivileged, read-only container with no deployment mounts, resource limits, a gateway as its only way to the API and an egress proxy as its only way out (README 6.5). The identity check stops routing to a backend that answers with another version or digest; it catches a wrong or stale image, not one that lies, which is what the isolation is for. A call carries a token encrypted and authenticated with a key derived from `WORKSPACE_AES_KEY` (60 seconds, opaque to the backend), and the broker that answers the backend's data requests applies the calling user's access and adds the data source's credentials itself. With `identity: "pseudonymous"` the backend learns an HMAC of the plugin and user ids, stable per plugin, and nothing else.
- **Logs.** One line per call: plugin, widget, outcome, bytes, duration. No arguments, bodies or secrets.

## 7. Residual risks

1. **What the plugin is given can leave through channels the policy does not govern.** Firefox resolves a frame's `preconnect` and WebKit its `dns-prefetch` and `preconnect` hints in DNS despite the policy and the meta; WebRTC is outside the policy; a frame can navigate itself, which the host notices only after the request has gone. Only the widget's own data enters the frame, and the admin's review of the package is the control.
2. **CPU and memory.** The watchdog ends a frozen frame only while the page's own thread runs. Whether a frame gets its own process depends on the browser: Chrome for Testing gave each sandboxed frame one, the headless shell kept them in the page's process, and there a busy loop slows the tab.
3. **Misleading content** inside the frame's own card.
4. **A mistaken or hostile approval.** The review's egress summary, risk ratings, closed defaults, narrowing and the event log are the mitigation; a digest ties execution to what was approved, not to what is safe.
5. **A hostile backend** is limited by the isolation the deployer gives it. Proxies keep a secret out of plugin code entirely; a backend that receives one can misuse it within the hosts it may reach.

## 8. Abuse cases and their tests

The Playwright specs generate their packages into a temporary plugins directory and run in Chromium, Firefox and WebKit.

| Abuse | Defense | Test |
|---|---|---|
| Read the parent or top document, `window.opener`, storage or cookies; `window.open`, top navigation, `alert`; `eval` | Opaque origin, sandbox, policy | `plugins.spec.ts`, plugin-cannot-leave-its-frame |
| `fetch`, WebSocket, `sendBeacon`, images and remote `import` to any host, from the frame and from nested and `data:` workers | Policy, in workers too | `plugins.spec.ts`, plugin-cannot-leave-its-frame and plugin-policy-violations-reach-the-administrator |
| Forged host messages through `window.postMessage`; a write to an undeclared param | The host ignores window messages; the authority | `plugins.spec.ts`, plugin-cannot-leave-its-frame |
| An ungranted or unknown command, `core:mcp:call`, reading the widget's `mcp_tool`, a `javascript:` link, markup in a notice, prototype pollution | Authority, host-only link, plain text, separate realm | `plugins.spec.ts`, plugin-cannot-leave-its-frame |
| Forged violation events; requests to 250 origins | `isTrusted`; caps; text only | `plugin-admin-journey.spec.ts` |
| Messages outside the protocol; protocol violations | Schema; three in ten seconds end the frame | `frame.test.ts`, `authority.test.ts` |
| Another window announcing itself as the frame; a frame asking again for a port; a message on another frame's port or through `window.postMessage` | One port, handed once to the frame's own window; the caller is its port | `PluginFrame.test.tsx` |
| A frame that navigates itself | A second `load` ends it | `PluginFrame.test.tsx`, `plugins.spec.ts`, a-frame-that-navigates-itself-is-ended |
| A frame that stops answering | Three missed pings end it; a hidden frame is not pinged | `PluginFrame.test.tsx` |
| A frame document with more than the shell, or without its policy first | The document's shape; the canary | `frame.test.ts`, `shell.conformance.test.ts` |
| Symbolic links, odd names, too many or too large files, an id or version unlike its directory, a wrong checksum or pin, a served path outside the version, `backend/` served | Discovery and file delivery | `test_widget_plugin_rules.py` |
| Policy sources that are too broad, private or insecure, with and without confirmations | The validator | `csp-cases.json`, in `csp.test.ts` and `test_widget_plugin_rules.py` |
| An organization admin approves or sets a secret; a role of another organization grants access | Authorization | `test_widget_plugins_api.py`, `test_widget_plugin_server_side.py` |
| A file edited after approval; a new version; a version whose files changed before approval; an old digest | The API re-hashes a file whose size or modification time changed, and the browser checks every file against the approved digest; explicit approval bound to the reviewed digest | `test_widget_plugins_api.py`, `plugin-admin-journey.spec.ts`, `bundle.test.ts`, `plugins.spec.ts`, the-host-refuses-files-that-differ-from-the-approved-version |
| A route that uploads or writes plugin files | None, except the copy of an approved version to a new number on a local stack, which every `MODE` but `local` refuses | `test_widget_plugins_api.py`, `test_widget_plugin_development.py` |
| A proxy aimed at a private or metadata address, a name that resolves to several addresses or changes, a bad certificate; arguments or secrets outside their places | Template rules and the outbound guard | `test_widget_plugin_proxies.py` |
| Reading a secret from the frame or the page; calls after narrowing or revoking; calls by users without access | Server-side secrets; availability on every call | `test_widget_plugin_server_side.py`, `plugin-proxies.spec.ts` |
| A backend reading data the user may not read, with a forged, changed or expired token, or after a version change | Token, broker and identity check | `test_widget_plugin_backends.py`, `plugin-backends.spec.ts` |
| A widget citing another backend's MCP server as its own | The link resolves against its own backend | `backendConnector.invalidItems.test.ts`, `mcpLink.test.ts` |
| A backend reaching the FINOS Workspace API or the internet, writing its image or data, or running privileged | In the SQL explorer example's deployment: internal networks, a gateway that forwards only the API's calls, a read-only container without capabilities or root | `docs/examples/sql-explorer/tests/test_isolation.py`, run by `examples.yml` |

## 9. Why a frame, and the install path

| Option | Like | Verdict |
|---|---|---|
| Load the module into the page | Module federation | No isolation at all. |
| A `srcdoc` frame with `allow-same-origin` | The HTML widget | The frame shares the page's origin and can lift its own sandbox. |
| An in-page realm that proxies the DOM | Grafana's frontend sandbox | Partial, and fragile with DOM-heavy libraries. |
| A worker with a host-drawn UI tree | Shopify's remote rendering | Strong, but no DOM or canvas for grids and charts. |
| An opaque-origin frame with a private port and a policy | Figma's plugin iframes | Used. |

Code reaches a deployment only through the plugins directory, the image or configuration: the app has no upload, no fetch from a URL and no route that writes plugin files, and the API mounts the directory read-only. The one route that writes there copies an approved version to a new number for a developer, and it works only where `MODE` is `local`, a developer's own machine; a version in development is served from changing files only there. A hijacked admin session can enable or grant a plugin that is already on the server, through the review and its acknowledgements, which are recorded; it cannot add one. A pin ties approval to a digest chosen outside the app.

## 10. Responsibility

FINOS Workspace limits what a plugin can reach and shows the admin what it asks for. It does not make a plugin safe, and nothing in the product says a plugin is safe or verified; `publisher` is the package's own claim. For admins: read the requests before approving, prefer plugins that ask for little (no server side over proxies over a backend), pin digests in production, grant a plugin only to the roles that need it, and watch its blocked requests.
