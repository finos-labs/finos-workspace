---
title: About the widget plugin security model
---

# About the widget plugin security model

This page explains what the plugin runtime defends, how it does so, and what it deliberately leaves to others. The exact rules are in the reference: [Plugin frame policy](../reference/plugins/frame-policy.mdx), [Plugin frame protocol](../reference/protocols/plugin-frame.mdx) and [Abuse cases and their tests](../reference/plugins/abuse-cases.md).

## What the runtime protects

The most important asset is the user's session. It lives in an HttpOnly cookie that page script cannot read, and the browser attaches it only to the host's own requests. The runtime also protects the integrity of the Workspace page and the data of every widget other than the one being rendered.

Beyond the page, the runtime protects the user's browser and its network position, because a browser can often reach an intranet that the server cannot. It protects the API, which a plugin must never be able to call as the user. It protects the plugin secrets. Finally, it protects the deployment's own files and network, including its database, cache, storage and other services.

## Who it defends against

The first adversary is a plugin's code. That code may be malicious from the start, it may be compromised later through its supply chain, or it may be exploited through the data that it renders. For that reason the runtime assumes that the code in the frame can run arbitrary JavaScript, and that the code in a plugin backend can run arbitrary code in its process. The second adversary is anyone who holds an administrator's web session.

## What lies outside the model

Four things lie outside this model. Bugs in the browser engine, the container runtime and the kernel are not covered. A compromised Workspace web app or API is not covered either. The deployer is trusted, because the deployer chooses what goes on the server. An admin who approves everything defeats the review, and the closed defaults, the risk ratings and the event log can only reduce that risk.

## The boundary of the sandbox

The sandbox protects the host and everything else on the page. It cannot stop a plugin from misusing the data that it was given to render, so the runtime limits that risk in three other ways. Each frame receives only the data of its own widget. The admin approves the network that the frame may reach. A reviewed and pinned digest must exist before a plugin is enabled.

## Three layers

Enforcement happens in three layers, and each layer covers a different kind of request.

| Layer | Enforced by | What it covers |
|---|---|---|
| Browser | The iframe's `sandbox` attribute and the frame's Content Security Policy, both set when the frame is created. | It controls access to the page and to storage, popups, navigation and the frame's own network access. |
| Host | The runtime authority, which checks every message from the frame. | It controls what the frame may ask the host to do, such as reading data, writing parameters or state, opening links, writing to the clipboard, downloading files and calling proxies or backends. |
| Server | The API's checks of availability, permissions, the outbound guard and the limits, together with the isolation that the deployer gives a backend. | It protects credentials, secrets, the deployment's files and network, and everything that a proxy or a backend can reach. |

As in Tauri, the frame's policy and the command permissions are separate mechanisms. The authority cannot check a host that the policy allows, because the policy acts inside the browser. Approving the policy is therefore the decision about the frame's network.

The frame has an opaque origin and no ambient authority. The session never enters the frame, the host makes every authenticated call, and secrets stay on the server. The host fetches the plugin's files with the user's session, checks each file against the approved digest, and sends the bytes into the frame, so the code that runs is the code that was approved.

## What remains

Some risks remain even with all of these measures.

1. **Data can leave through channels that the policy does not govern.** Firefox resolves a frame's `preconnect` hints in DNS despite the policy and the meta tag, and WebKit does the same for `dns-prefetch` and `preconnect`. WebRTC lies outside the policy. A frame can also navigate itself, and the host notices that only after the request has gone. Only the widget's own data enters the frame, and the admin's review of the package is the control.
2. **A plugin can consume CPU and memory.** The watchdog ends a frozen frame only while the page's own thread is running. Whether a frame gets its own process depends on the browser. Chrome for Testing gave each sandboxed frame a process, but the headless shell kept the frames in the page's process, and there a busy loop slows the whole tab.
3. **A plugin can show misleading content** inside its own card.
4. **An admin can approve a plugin by mistake, or an attacker can cause that.** The review's egress summary, the risk ratings, the closed defaults, narrowing and the event log reduce that risk. A digest ties execution to what was approved, but it does not say that the code is safe.
5. **A hostile backend is limited only by the isolation that the deployer gives it.** Proxies keep a secret out of plugin code entirely, but a backend that receives a secret can misuse it against the hosts that it may reach.

## Responsibility

Workspace limits what a plugin can reach and shows the admin what the plugin asks for. It does not make a plugin safe, and nothing in the product says that a plugin is safe or verified. The `publisher` field is the package's own claim.

Admins should therefore read the requests before they approve a plugin. They should prefer plugins that ask for little: a plugin without server-side code is better than one with proxies, and a plugin with proxies is better than one with a backend. In production they should pin digests, grant a plugin only to the roles that need it, and watch its blocked requests.
