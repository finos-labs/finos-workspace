---
title: How to add a data backend for your organization
sidebar_position: 6
---

# How to add a data backend for your organization

A backend that you connect from the Connections page belongs to you. A person of type User cannot add connections, so they get a backend from the organization or from a role. A backend that is added for the organization reaches every person of the organization when they sign in, and they can use all of its widgets. This guide adds one with the admin command line and then lists and removes it. You need access to the API's container, because the tool runs there. To give a backend to some people only, connect it yourself and share it through a role instead, as [How to give a role access to data](give-a-role-access-to-data.md) describes.

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

The tool prints `Data backend 'Sales' added to entity` and the id. When the backend needs credentials, add `--header` once for each header, written as `key:value` or as `key:value:location`, where the location is `headers` or `query`. The tool stores the credentials with the backend and the web app sends them with every request to it.

The address must be one that people's browsers can reach, because the web app calls the backend from the browser. The API does not call it.

## List and remove backends

```bash
python -m scripts.workspace_admin data-backend list <entity-id>
python -m scripts.workspace_admin data-backend delete <entity-id> --name "Sales"
```

The list shows each backend's id, name and address. Deleting by name removes the backend from the organization.

## Let a role use it

A new organization backend appears for every person in the organization, next to their own connections if they have any, and the grants of a role do not narrow it: a person who has the role in [How to give a role access to data](give-a-role-access-to-data.md) uses all of its widgets, like everyone else. Add a backend for the organization only when everyone in it may use all of its widgets.

[Admin command line](../../reference/command-line/admin-cli.mdx) lists every command and its arguments.
