---
title: Add an MCP App to a dashboard
sidebar_position: 15
---

# Add an MCP App to a dashboard

An MCP server can link one of its tools to an interactive page, an MCP App, as the [MCP Apps extension](https://github.com/modelcontextprotocol/ext-apps) describes. The MCP App widget shows that page on a dashboard: a blotter you can filter, a chart you can zoom, a form that books a trade. The page reaches its server only through the FINOS Workspace's own MCP connection, and the Copilot can read what it shows.

## What you need

- An MCP server, added under AI and MCP Servers, with at least one tool whose `_meta.ui.resourceUri` names a `ui://` resource of type `text/html;profile=mcp-app`. The FINOS Workspace tells servers that it supports the extension when it connects, so a server that offers its apps only to such clients lists them.
- A deployment with an MCP App sandbox origin. An administrator sets it up as [Run the sandbox origin](#run-the-sandbox-origin) describes. Without one, the widget says "MCP Apps are not set up: MCP_APPS_SANDBOX_URL is empty."

## Add the widget

1. Open the widget menu with Add widgets, or Ctrl+K, or Cmd+K on a Mac, and choose MCP App, under Others and Utils.
2. In MCP server, choose the server. The list has only the servers that are connected and offer a tool with an app.
3. In Tool, choose the tool. A new widget starts on a tool that says it only reads, when the server has one.
4. In Arguments (JSON), type the tool's arguments as a JSON object, for example `{"status": "open"}`, or leave `{}`.
5. Select Show app.

The widget takes the tool's title as its name, and keeps following the tool while you leave the name alone. A name you type stays. The Copilot names its tables after widgets, so two apps from one server keep different names.

Settings opens the form again, and Refresh reloads the app and runs its tool again.

## When the app runs a tool

The widget runs the tool you chose when the app opens. A tool that says it only reads, with the annotation `readOnlyHint`, runs on its own. Any other tool waits until you select Run, so a dashboard never changes data just because it opened.

The app can call other tools of its server as you use it. A tool that says it only reads runs at once. For any other tool, the widget asks first. It shows the tool and the arguments the app sent, and you choose Allow once or Deny. It asks about one call at a time, and refuses any call still waiting when you close the app. The app can call only tools that are ticked in the MCP Tools dialog, and never a tool whose visibility, set by its server, leaves out apps. The Copilot is likewise never offered, or suggested, a tool whose visibility leaves out the model.

## What the Copilot sees

When the app reports what it shows, the widget passes it to the Copilot. Rows become a table the Copilot can query, up to 2000 rows or 1 MB, and a summary such as "50 orders shown, more available" appears next to the widget's name. When the rows change, for example after you filter the app, the Copilot drops the rows it kept for the conversation and reads them again. An app that reports nothing passes on the rows of the tool's result instead. A widget whose definition sets `disableRetrievalForCopilot` passes nothing.

The Copilot treats all of this as data from the app's server, never as instructions.

## How the app is isolated

- **A separate origin.** The app runs on the sandbox origin, never on the FINOS Workspace's origin, so it cannot read the page, its cookies or its storage. When the sandbox address has a `*`, each MCP server gets an origin of its own, so apps from different servers share no storage either.
- **An opaque view.** Inside the sandbox origin, the app's page runs with an opaque origin. It cannot reach the sandbox page that relays its messages, or keep anything in the sandbox origin's storage.
- **A narrow policy.** The sandbox page's Content-Security-Policy allows only the domains that the app declares in `_meta.ui.csp`, and nothing for a declaration that is not a plain origin. A wildcard over a whole top-level domain, such as `https://*.com`, is dropped. Only the FINOS Workspace's origins may frame the page.
- **Workspace's connection.** Every tool call and resource read from the app goes through the FINOS Workspace's MCP proxy, which checks the call against your roles, adds the server's sign-in and refuses addresses that may not be reached, as it does for the Copilot.
- **Links.** The app may ask to open `http` and `https` links only, and they open in a new tab with no reference back.

## Run the sandbox origin

The web app's container serves the sandbox page on a second port, 8081, and nothing else there: every other path answers 404. Two settings of the container, which [Web app settings](../../reference/configuration/web-app.mdx) lists, connect the two:

| Variable | Example | What it does |
|---|---|---|
| `MCP_APPS_SANDBOX_URL` | `https://*.mcp-sandbox.example.net` | The address the app frames MCP Apps from. A `*` as the first label of the host gives each MCP server an origin of its own: the first 32 hex digits of the SHA-256 of the server's address. |
| `MCP_APPS_HOST_ORIGINS` | `https://workspace.example.com` | The origins that may frame the sandbox page, separated by spaces. |

In production:

1. Pick a domain for the sandbox that is **not under the same registrable domain** as the app or the API, for example `mcp-sandbox.example.net` for an app at `workspace.example.com`. Browsers treat subdomains of one registrable domain as the same site, so cookies would reach the sandbox. The widget warns when the last two labels of the host names match. It does not consult the Public Suffix List, so check domains such as `example.co.uk` yourself.
2. Create a wildcard DNS record, `*.mcp-sandbox.example.net`, and a wildcard certificate for it.
3. Route that host to port 8081 of the web container, for example with a second rule in your Ingress and a second port, `sandbox` on 8081, in the web Service.
4. Set `MCP_APPS_SANDBOX_URL` to `https://*.mcp-sandbox.example.net` and `MCP_APPS_HOST_ORIGINS` to the app's origin.

Without a `*`, the widget works but warns that apps from every server share one origin and its storage.

For local development, Docker Compose maps port 8081 to 3001 and sets `MCP_APPS_SANDBOX_URL` to `http://*.sandbox.localhost:3001`. Chrome and Firefox send every subdomain of `localhost` to your own machine, so no DNS is needed. Safari does not, so use Chrome or Firefox.
