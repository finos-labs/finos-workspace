---
title: How to add a data backend for your organization
sidebar_position: 7
---

# How to add a data backend for your organization

A backend that you connect from the Connections page belongs to you, and it ends with your account. A backend that you add for the organization with the admin command line belongs to the organization: it stays when people come and go, and no person's account owns it. Nobody but an admin uses it until a role grants it, so a person of type User, who cannot add connections of their own, gets it the same way as any other shared backend. This guide adds one with the admin command line, lists and removes it, and grants it to a role. You need access to the API's container, because the tool runs there.

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

A new organization backend reaches no one yet except the admins, who see it in the list of backends that a role can grant. Grant it to a role, as [How to give a role access to data](give-a-role-access-to-data.md) describes: a role may grant the whole backend or only some of its widgets. A person whose roles grant none of it does not see the backend and cannot use its widgets.

[Admin command line](../../technical-guide/reference/command-line/admin-cli.mdx) lists every command and its arguments.
