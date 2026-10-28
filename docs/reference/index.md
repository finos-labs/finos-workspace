---
slug: /reference
title: Reference
sidebar_label: Overview
sidebar_position: 0
---

# Reference

Reference states how the machinery works: its interfaces, formats, settings and commands. It follows the structure of the code, it describes and does not instruct, and it gives no opinions. To learn by doing, start with the [Quick Start](../quick-start.mdx). For tasks, use the [User Guide](../user-guide/index.md) and the [Technical Guide](../technical-guide/index.md). For common questions, read the [FAQ](../faq/index.md).

The reference has these sections:

- **[Transports](transports.mdx)** lists every channel between the browser and the services, and between the services, with what carries it and what authenticates it.
- **Protocols** describe the messages that two parts of FINOS Workspace exchange: the [plugin frame protocol](../plugins/reference/plugin-frame.mdx), the [iframe widget protocol](protocols/iframe-widget.mdx), the [widget requests](protocols/widget-requests.mdx) that a backend receives, the [rows](protocols/raw-rows.md) that a widget can answer with, the [MCP tool link](protocols/mcp-tool-link.md), the [FINOS Workspace bridge](../mcp/reference/workspace-bridge.mdx) between the MCP server and a browser tab, the [agent query protocol](protocols/ines-query.mdx), the [widget data](protocols/ines-widget-data.mdx) that the browser fetches for the agent, the [typed results](protocols/ines-tool-results.mdx) that a tool can return to the agent, and [agent authentication](protocols/agent-authentication.mdx).
- **HTTP API** lists the [routes of the FINOS Workspace API](http-api/workspace-api.mdx) and the [models](http-api/workspace-api-schemas.mdx) that they exchange, and the [routes of Ines](http-api/ines-api.mdx) with its metrics.
- **MCP** lists the tools, resources and prompts of the [FINOS Workspace MCP server](../mcp/reference/tools.mdx), and the tools of the [Ines MCP server](mcp/ines-mcp.mdx).
- **Widget plugins** describe the [package and manifest](../plugins/reference/package-and-manifest.mdx), the [module contract](../plugins/reference/module-contract.mdx), the [permissions and commands](../plugins/reference/commands-and-permissions.mdx), the [frame policy](../plugins/reference/frame-policy.mdx), [proxies](../plugins/reference/proxies.mdx), [backends](../plugins/reference/backends.mdx) and the [lifecycle](../plugins/reference/lifecycle.mdx).
- **Schemas** give the JSON Schemas of [widgets.json](schemas/widgets-json.mdx), [apps.json](schemas/apps-json.mdx) and [plugin.json](../plugins/reference/plugin-json.mdx), the format of [agents.json](schemas/agents-json.mdx), and the [database tables](schemas/database.mdx).
- **Configuration** lists the settings of the [web app](configuration/web-app.mdx), the [backend](configuration/backend.mdx) and [Ines and its MCP server](configuration/agent.mdx).
- **Command line** describes the [admin CLI](command-line/admin-cli.mdx).
- **CSS** documents everything that a stylesheet can use to change the web app, beginning with [styling surfaces](css/styling-surfaces.mdx).
