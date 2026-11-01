---
title: Connector
sidebar_position: 4
---

# Connector

A connector brings your data into FINOS Workspace. It is a web server, also called a data backend, that you write and run.

- A connector describes its [widgets](widget.md) in `widgets.json` and its [apps](app.md) in `apps.json`, and it answers the requests of its widgets.
- The FINOS Workspace API calls the connector for the browser. It adds the connection's credentials, the header `X-Workspace-User` with the user's email and the signed header `X-Workspace-Identity`, and the browser holds none of them, so the connector needs no CORS settings for the web app.
- A connector that a person connects belongs to that person. A connector that an admin adds belongs to the organization, and nobody but an admin uses it until a role grants it.
- Credentials belong to the connection, never to a widget parameter.

## Where to go

- **Use it:** [Connect a backend](../features/data-backends/connect-a-backend.md), [Add a data backend for your organization](../features/administration/add-a-data-backend-for-your-organization.md)
- **Build it:** [Build a backend](../tutorials/build-a-backend/index.mdx)
- **Look it up:** [widgets.json](../reference/schemas/widgets-json.mdx), [Widget requests](../reference/protocols/widget-requests.mdx)
