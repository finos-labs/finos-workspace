---
title: Widget plugins
sidebar_position: 7
---

# Widget plugins

FINOS Workspace ships with a fixed set of widget types: markdown, HTML, news feed, PDF and iframe. Widget plugins let a deployment add more types, such as charts, without changing FINOS Workspace itself. A plugin is a package that someone builds outside this repository. The person who deploys FINOS Workspace places the package on the server, a superuser reviews and approves it, and an organization's admin enables it for roles. Each widget that a plugin provides then runs in its own sandboxed frame, and it never receives the user's credentials.

## What a plugin is

A plugin is a directory. It holds a manifest named `plugin.json`, one bundled module named `entry.js`, optional style sheets and assets, and optionally a `backend/` directory with server-side code. The module follows the [Anywidget front-end module](https://anywidget.dev/en/afm/) contract, so a developer who already writes Jupyter widgets knows how to write one.

A plugin can offer widgets in four ways:

- A widget can draw a type that a backend declares in its `widgets.json`, for example `"type": "plotly"`. The host fetches the data from the backend and passes it to the widget.
- A widget can stand alone in the Add widget menu and be configured only through its own settings.
- A widget can call proxies that the manifest declares. The API makes those calls and adds the secrets on the server.
- A widget can call the plugin's own backend, which the deployment runs as a separate process.

Nobody installs a plugin from the app. The app has no upload, it does not fetch packages from a URL, and it has no endpoint that writes plugin files, except on a developer's own machine. There, where `MODE` is `local`, a superuser can copy an approved version to the next version number and develop it in place. Everywhere else the app only decides whether files that are already on the server may run, and for whom.

## How it compares to other systems

Each part of the design has a counterpart in a system that many people already know.

| Part of the design | Comparable system | What it gives you |
|---|---|---|
| Permissions are checked on every call and denied unless granted. | Tauri's capabilities and its runtime authority. | A plugin can do only what its manifest asks for and an admin approved. |
| A version is reviewed before it runs, and an update that asks for more waits for approval. | A browser extension that is paused until the user accepts the new permissions of an update. | Nothing new takes effect unless an admin acts. |
| The module follows one contract. | Anywidget in Jupyter. | Existing anywidget modules can be re-packaged. |
| Every widget gets its own sandboxed frame and talks to the page over a private message channel. | Figma's plugin iframes. | Plugin code cannot reach the page, the session or another widget. |
| An approval is bound to a digest of the files. | A container image that is pinned by digest. | The code that runs is the code that was approved. |
| The manifest declares proxies, and the server adds the secrets. | Grafana's data source proxy routes. | A key never reaches the browser. |
| A backend runs as its own process. | Grafana's backend plugins. | Plugin server code never runs inside the API. |
| The app cannot install plugins. | Grafana with `plugin_admin_enabled` turned off, and WordPress with `DISALLOW_FILE_MODS`. | A stolen admin session cannot deploy code. |

## How it runs

The diagram shows where the pieces live. The browser tab hosts the FINOS Workspace page and one sandboxed frame for each plugin widget. The API holds the reviews and the plugin files. A plugin backend, if there is one, runs as a separate process that the deployer isolates.

```
Browser tab (FINOS Workspace)
  the host: PluginWidget fetches the widget's data with the user's session,
            pushes it into the frame, and checks every command against the
            widget's permissions
     |  MessageChannel port, private to one frame
  <iframe sandbox="allow-scripts" srcdoc="...">   opaque origin, no storage
     the shell: the policy in a <meta> tag, a self-check (the canary),
                then the plugin's module, checked against its digest

FINOS Workspace API
  reads the plugins directory (read-only), records reviews and grants,
  serves files after re-hashing them, makes proxy calls, routes backend calls,
  answers a backend's data requests for the calling user

Plugin backend (optional)
  a separate process or container the deployer runs and isolates
```

A frame starts in a fixed order. First the host asks the API for the user's plugin list with `GET /app/widget-plugins`. It then creates the frame with the policy that the API composed, hands the frame a port, and waits until the shell's canary proves that the origin is opaque and that the policy is enforced. Only after that does the host fetch the plugin's files, check the SHA-256 of each file against the approved digest, and send the files into the frame. The module's `initialize` and `render` functions then run, and from that point on the host pushes data, parameters and the theme into the model and answers the module's commands. [Plugin frame protocol](../reference/protocols/plugin-frame.mdx) lists every message.

## Who does what

Four kinds of people take part in running a plugin, and each can do only part of the work.

| Task | Deployer | Superuser | Organization admin | Role member |
|---|---|---|---|---|
| Place a package, pin its digest and run its backend | Yes | | | |
| Rescan, review and approve a version, and revoke, restore or forget a plugin | | Yes | | |
| Override the frame's policy and the server network, and set secrets | | Yes | | |
| Enable a plugin for organizations | | Yes, for any | Yes, for their own | |
| Choose which plugin renders a type, change settings, narrow permissions, policy and hosts, and map data sources | | | Yes, for their own | |
| Grant widget types to roles | | | Yes, for their own | |
| Use the widgets | | | Through a role | Through a role |

A widget type is available to a user only when four conditions hold. The plugin must be enabled, its active version must be approved, the user's organization must have enabled it, and one of the user's roles must grant either that widget or all of the plugin's widgets. Admins are no exception, because they use a plugin through a role like everyone else. The seeded administrator is both a superuser and an organization admin, so on a single-organization deployment one person does the whole flow. [Plugin lifecycle and administration](../reference/plugins/lifecycle.mdx) lists the steps.

## Why a frame

Several designs could isolate plugin code. The table compares them with systems that made the same choice.

| Design | Comparable system | Verdict |
|---|---|---|
| Load the module straight into the page. | Module federation. | It gives no isolation at all. |
| Use a `srcdoc` frame with `allow-same-origin`. | The HTML widget. | The frame shares the page's origin and can lift its own sandbox. |
| Run the module in an in-page realm that proxies the DOM. | Grafana's frontend sandbox. | It isolates only in part and breaks easily with DOM-heavy libraries. |
| Run the module in a worker and draw its UI tree from the host. | Shopify's remote rendering. | It isolates strongly, but it offers no DOM or canvas, which grids and charts need. |
| Use an opaque-origin frame with a private port and a policy. | Figma's plugin iframes. | FINOS Workspace uses this design. |

Code reaches a deployment only through the plugins directory, the image or the configuration, and the API mounts that directory read-only. The one route that writes there copies an approved version to a new number for a developer. It works only where `MODE` is `local`, a developer's own machine, and a version in development is served from changing files only there. A hijacked admin session can enable or grant a plugin that is already on the server, but only through the review and its recorded acknowledgements, and it cannot add a plugin. A pin ties the approval to a digest that was chosen outside the app.

[The widget plugin security model](widget-plugin-security.md) explains what the sandbox defends and what it leaves to others.
