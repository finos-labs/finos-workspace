---
title: Manage organizations and move users between them
sidebar_position: 8
---

# Manage organizations and move users between them

A deployment can serve several organizations. Each organization has its own users, roles, backends and settings, and the people of one organization never see those of another. This guide is for a superuser, the account that runs the deployment: it adds an organization, changes whether it may share, and moves a user from one organization to another. An ordinary admin sees only their own organization, and the page Entities is missing from their admin area. FINOS Workspace calls an organization an entity.

## Open Entity Management

Open the admin area and select Entities. The page is titled Entity Management and says "Organizations, whether they may share, their permission maps and their users." It has three tabs: Entities, Permission maps and All users.

## Add an organization

1. On the tab Entities, select Add entity.
2. Type the Name of the organization. Names are unique, and a second organization with the same name gives an error.
3. Leave Sharing enabled on, or switch it off. When it is off, no one in the organization can share or receive items, and the shares that exist are revoked.
4. Fill in the first name, the last name and the email address of the organization's first administrator, with Admin first name, Admin last name and Admin email.
5. Select Add entity.

Messages say "Entity added" and "Administrator added". The administrator gets the type Admin, and FINOS Workspace shows the link that sets their password, which you give to them yourself, as [Add a user](add-a-user.mdx) describes. A deployment that you start with the files of this repository already has one organization, which the first start created from `config.toml`. To create an organization and all of its people from a file, follow [Provision an organization from a file](../../tutorials/deploy/provision-an-organization.mdx).

The table lists each organization with its Name, whether Sharing is Enabled or Disabled and its Status, Active or Disabled. The button Edit entity at the end of a row changes the name, the sharing switch and the Disabled switch, and a message says "Entity updated". The button Remove entity next to it removes the organization.

## Disable an organization

Turn on the switch Disabled in the dialog Edit entity and select Save. No one in the organization can sign in any more, whichever way they sign in, and their sessions end at once. Their dashboards, roles and backends stay, and turning the switch off lets them sign in again.

An organization that has a superuser cannot be disabled, and FINOS Workspace answers "Cannot disable an entity that has a superuser". A superuser who is moved into a disabled organization can still sign in.

## Remove an organization

Select Remove entity at the end of the row and confirm with Yes, Remove. A message says "Entity removed". An organization that still has users is not removed, and a message says "Cannot delete entity with existing users": move its users to another organization first, as the next section describes, or disable the organization instead. The organization leaves every list and its name is free for a new organization. FINOS Workspace keeps its permission maps, roles, settings and backends, and you can bring the organization back, as the next section describes.

## Restore a removed organization

1. On the tab Entities, turn on the switch Show removed. The table lists the removed organizations under the names they had.
2. Select Restore entity at the end of the row.
3. In the dialog Restore entity, keep the Name or change it, and select Restore. A message says "Entity restored".

The organization comes back with its permission maps, roles, settings and backends. When another organization has taken the name, FINOS Workspace answers "An entity with this name already exists", and you restore the organization under another name. A removed organization has no users. Give it an administrator again from the command line, and give them the link that sets their password:

```bash
python -m scripts.workspace_admin user create <entity-uuid> --email <email> --first-name <first name> --last-name <last name> --role admin
```

## What the other tabs show

- **Permission maps** list the user types that each organization offers. Every organization has three: Admin, Developer and User, and FINOS Workspace creates them with the organization. A user belongs to an organization through one of its permission maps, which is how a person is at the same time a member of an organization and an Admin, a Developer or a User in it. Add permission map joins an organization to a user type that it lacks.
- **All users** lists every user of every organization with the columns Email, Entity and User type, and its search box finds a person by email address.

## Move a user to another organization

1. On the tab All users, find the person, and select the button Move user at the end of their row.
2. In the dialog Move user, which shows the person's email address, choose the Entity that they should belong to and their User type there, which is Admin, Developer or User.
3. Read the note: "In another entity the user leaves the roles of this one and gets that entity's Agent User. Their sessions end." Select Move.

A message says "User moved". The person's sessions end at once, so they sign in again. A move to another organization takes the person's roles of the old organization away, gives them the role Agent User of the new organization, and ends every share between them and the people of the old organization, in both directions. Their dashboards stay with their account. Choosing the same organization and another user type changes only the type, and it ends the sessions too.

The same move is available from the command line, which is the way to put back a person who was removed from an organization:

```bash
python -m scripts.workspace_admin user move --email <email> --entity-uuid <entity-uuid> --role user
```

[Admin command line](../../reference/command-line/admin-cli.mdx) lists the commands for organizations and users, including `entity delete`, which removes an organization that has no users left, `entity list --removed` and `entity restore`, which brings a removed organization back.
