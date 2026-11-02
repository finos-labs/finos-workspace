---
title: Add a data backend for your organization
sidebar_position: 7
---

# Add a data backend for your organization

A backend that you connect from the Connections page belongs to you, and it ends with your account. A backend that you add for the organization with the admin command line belongs to the organization: it stays when people come and go, and no person's account owns it. Nobody uses it until a role grants it, an admin included, so a person of type User, who cannot add connections of their own, gets it the same way as any other shared backend. This guide adds one with the admin command line, lists and removes it, and grants it to a role. You need access to the API's container, because the tool runs there.

## Find the organization's id

Run the tool in the API container. On Kubernetes that is `kubectl exec` into a pod of the API, and on the local stack it is `docker compose exec api`. This command lists the organizations with their ids:

```bash
python -m scripts.workspace_admin entity list
```

Each line shows an id, a name and whether sharing is on, in the form `<id> | <name> | Sharing: on`. Copy the id of your organization.

## Add the backend

Give the command the id, a name and the backend's address:

```bash
python -m scripts.workspace_admin data-backend add <entity-id> --name "Sales" --url https://sales.example.com
```

The tool prints `Data backend 'Sales' added to entity` and the id. When the backend needs credentials, add `--header` once for each header, written as `key:value` or as `key:value:location`, where the location is `headers` or `query`. The tool stores the credentials with the backend. The API adds them to every request that it sends to the backend, and no browser receives their values.

The address must be one that the API can reach, because the API calls the backend for the browser. The browser does not call it.

## List and remove backends

```bash
python -m scripts.workspace_admin data-backend list <entity-id>
python -m scripts.workspace_admin data-backend delete <entity-id> --name "Sales"
```

The list shows each backend's id, name and address. Deleting by name removes the backend from the organization.

## Let a role use it

A new organization backend reaches no one yet, an admin included. The admin area lists it, so that an admin can grant it: the dialog Setup Permissions shows it under Backend Widgets with the value No Access, and without widgets, because the web app reads the widgets of a backend as the person who is signed in, and no role of the admin grants it yet. Set it to Access for a role that you belong to and save, as [Give a role access to data](give-a-role-access-to-data.md) describes. Open the dialog again to see its widgets, and grant the widgets that other roles may use. A person whose roles grant none of the backend does not see it and cannot use its widgets.

[Admin command line](../../reference/command-line/admin-cli.mdx) lists every command and its arguments.
