---
slug: /reference
title: Reference
sidebar_label: Overview
sidebar_position: 0
---

# Reference

Reference states how the machinery works: its interfaces, formats, settings and commands. It follows the structure of the code, it describes and does not instruct, and it gives no opinions. To learn by doing, use the [tutorials](/tutorials). For a task, use the [how-to guides](/how-to). For the reasons behind the design, read the [explanation](/explanation).

The reference has these sections:

- **[Transports](transports.md)** lists every channel between the browser and the services, and between the services, with what carries it and what authenticates it.
- **Protocols** describe the messages that two parts of Workspace exchange: the [plugin frame protocol](protocols/plugin-frame.md), the [iframe widget protocol](protocols/iframe-widget.md), the [widget requests](protocols/widget-requests.md) that a backend receives, the [rows](protocols/raw-rows.md) that a widget can answer with, the [MCP tool link](protocols/mcp-tool-link.md), the [Workspace bridge](protocols/workspace-bridge.md) between the MCP server and a browser tab, the [agent query protocol](protocols/ines-query.md), the [widget data](protocols/ines-widget-data.md) that the browser fetches for the agent, the [typed results](protocols/ines-tool-results.md) that a tool can return to the agent, and [agent authentication](protocols/agent-authentication.md).
- **HTTP API** lists the [routes of the Workspace API](http-api/workspace-api.mdx) and the [models](http-api/workspace-api-schemas.mdx) that they exchange, and the [routes of Ines](http-api/ines-api.md) with its metrics.
- **MCP** lists the tools, resources and prompts of the [Workspace MCP server](mcp/workspace-mcp.mdx), and the tools of the [Ines MCP server](mcp/ines-mcp.md).
- **Widget plugins** describe the [package and manifest](plugins/package-and-manifest.md), the [module contract](plugins/module-contract.md), the [permissions and commands](plugins/commands-and-permissions.md), the [frame policy](plugins/frame-policy.md), [proxies](plugins/proxies.md), [backends](plugins/backends.md) and the [lifecycle](plugins/lifecycle.md).
- **Schemas** give the JSON Schemas of [widgets.json](schemas/widgets-json.mdx), [apps.json](schemas/apps-json.mdx) and [plugin.json](schemas/plugin-json.mdx), the format of [agents.json](schemas/agents-json.md), and the [database tables](schemas/database.mdx).
- **Configuration** lists the settings of the [web app](configuration/web-app.mdx), the [backend](configuration/backend.mdx) and [Ines and its MCP server](configuration/agent.mdx).
- **Command line** describes the [admin CLI](command-line/admin-cli.mdx).
- **CSS** documents everything that a stylesheet can use to change the web app, beginning with [styling surfaces](css/styling-surfaces.mdx).
