---
title: MCP server
sidebar_position: 6
---

# MCP server

An MCP server gives the [Agent](agent.md) tools that FINOS Workspace does not have, such as a search of a knowledge base or a query of a system of your company. It is a web server that speaks the Model Context Protocol over streamable HTTP, and you connect it the way you connect a [connector](connector.md).

- A server comes from one of three places: a person adds it, the deployment adds it for everyone, or a connector declares it.
- A person who adds a server owns the connection. Only an Admin or a Developer account can add one.
- The Agent can call a tool only when a role grants it. A server that a connector declares grants all its tools to the people who can use that connector.
- Your browser sends every call to the FINOS Workspace API, which makes the call to the server and adds the headers that are stored for it, as it does for a connector. The API reaches a private address only for a superuser's server or on a local stack, and a server on your own computer works only on a local stack.
- A server proves who you are with its own sign-in (OAuth) or with a token that you give as a header. The token stays with the connection, never in a question.
- A [widget](widget.md) can name one tool of its connector's server, so that the Agent reads the widget's data with that tool.

An MCP server is not the [MCP Companion](mcp-companion.md). A server gives tools to the Agent. The Companion is a server that FINOS Workspace itself offers, so that an AI tool outside it can work with your dashboards.

## Where to go

- **Use it:** [Give the Agent tools from an MCP server](../features/agent/give-the-agent-tools-from-an-mcp-server.mdx)
- **Grant it:** [Choose the models and tools of a role](../features/administration/choose-the-models-and-tools-of-a-role.md)
- **Build it:** [Link a widget to an MCP tool](../tutorials/build-a-backend/link-a-widget-to-an-mcp-tool.md)
- **Look it up:** [MCP tool link](../reference/protocols/mcp-tool-link.md), [Agent query protocol](../reference/protocols/agent-query.mdx#function-calls), [apps.json](../reference/schemas/apps-json.mdx)
