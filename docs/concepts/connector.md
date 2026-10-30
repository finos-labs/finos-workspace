---
title: Connector
sidebar_position: 4
---

# Connector

A connector brings your data into FINOS Workspace. It is a web server, also called a data backend, that you write and run.

- A connector describes its [widgets](widget.md) in `widgets.json` and its [apps](app.md) in `apps.json`, and it answers the requests of its widgets.
- The browser calls the connector directly, so the connector has to allow the web app's address.
- A connector that a person connects belongs to that person. A connector that an admin adds belongs to the organization, and nobody but an admin uses it until a role grants it.
- Credentials belong to the connection, never to a widget parameter.

- **Use it:** [Connect a backend](../features/data-backends/connect-a-backend.md), [Add a data backend for your organization](../features/administration/add-a-data-backend-for-your-organization.md)
- **Build it:** [Build a backend](../tutorials/build-a-backend/index.mdx)
- **Look it up:** [widgets.json](../reference/schemas/widgets-json.mdx), [Widget requests](../reference/protocols/widget-requests.mdx)
