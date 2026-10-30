---
title: Admin
sidebar_position: 8
---

# Admin

Admins manage an organization: its users, roles, connectors and look.

- An **organization** has its own users, roles, connectors and settings. A user belongs to exactly one organization.
- A user has a **type**: Admin, Developer or User. The type says what kind of user the person is.
- A **role** is a named set of grants: access to [connectors](connector.md), widgets and [apps](app.md), the models and tools of the [Agent](agent.md), widget [plugins](plugin.md), a daily allowance, and a sharing level.
- Nothing is allowed unless a role grants it.
- A **superuser** runs the deployment, adds organizations and approves plugins.

| | |
|---|---|
| Use it | [Add a user](../features/administration/add-a-user.mdx), [Create a role](../features/administration/create-a-role.md), [Give a role access to data](../features/administration/give-a-role-access-to-data.md), [Manage organizations](../features/administration/manage-organizations.md) |
| Look it up | [FINOS Workspace API](../reference/http-api/workspace-api.mdx), [Admin CLI](../reference/command-line/admin-cli.mdx) |
