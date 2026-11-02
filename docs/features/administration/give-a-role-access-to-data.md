---
title: Give a role access to data
sidebar_position: 6
---

# Give a role access to data

A backend reaches the other people of your organization only through a role. This guide grants a role access to a backend and its widgets, and shows what the people in the role see when you do and when you do not. You need an account of type Admin, a role, and a backend that you connected from the Connections page or one that you added for the whole organization with the command line, as [Add a data backend for your organization](add-a-data-backend-for-your-organization.md) describes.

## Grant access

1. Open the admin area at `/admin` and select Roles and Access.
2. Select Edit permissions above the table. The dialog Setup Permissions opens.
3. Choose the role in the selector at the top left. The dialog loads what the role grants now.
4. Open the tab Widgets. The group Backend Widgets lists the backends that you connected and the backends of your organization. Each backend has a menu with the values Access and No Access.
5. Set the backend to Access. Setting it to No Access instead resets all of its widgets to No Access and disables their menus. Select the arrow in front of the backend to open its widgets, and set each widget that the role may use to Access, because the backend's own setting does not grant any widget by itself.
6. Select Save changes.

Before it saves, FINOS Workspace shows Confirm Permission Changes. The dialog warns that you are about to make critical changes to the permissions of the role, and it counts what you changed: how many widgets and prompts you added and how many you removed. Select Yes, Continue. A message says that the role permissions were updated.

The dialog lists the widgets of a backend only when one of your own roles grants the backend, because the web app reads the widgets as you. A backend of the organization that no role grants yet appears without widgets. Set it to Access for a role that you belong to and save, then open the dialog again and set its widgets.

The search box at the top filters the lists by name. The tab Apps lists the apps that the backends offer, with the prompts that belong to them, and the tab Prompt Library lists the prompts that people saved. Each has the same menus. A tab says "No items found" when its backends offer none.

## What people see

The web app loads the data of the widgets that at least one of a person's roles grants, and of no others. The library of a person in the role lists every widget of the backend, marked as shared, but a widget that no role grants shows "You don't have access to this widget" and a button, Remove Widget, when it is on a dashboard, and a widget that a role grants shows its data.

The API enforces the same grants, so a person cannot reach the data of a widget by sending its address to the API. For a backend that a person has only through a role, the API passes a request on to the backend only when the route belongs to a widget that one of the person's roles grants, and it answers 403 to every other request. The backend's own catalog files and the images of its apps are the exceptions, which [Requests that a widget sends](../../tutorials/build-a-backend/requests-from-a-widget.md#which-routes-the-api-sends) lists. A person who connected the backend on the Connections page is not limited by roles. The API adds the person's email as `X-Workspace-User` and the signed header `X-Workspace-Identity` to every request that it passes on. A backend that has to withhold some data from some people within a widget decides that itself, from those headers, which [Requests that a widget sends](../../tutorials/build-a-backend/requests-from-a-widget.md#the-widgets-request) describes.

Dashboards that people share carry their widgets with them, but not the right to see the data. When a person opens a shared dashboard and has no way to reach the backend of a widget on it, because it is not theirs and no role gives it to them, the widget shows "This data connection is not available to you" with the same button Remove Widget. When a role grants the backend and the widget, the widget shows its data as it does for the owner. That is why the message that appears when someone shares a dashboard says "Please note that shared users will not be able to view Data connectors widgets.": the share gives the recipient the dashboard and not the data.

The apps of a backend follow the same rule on the tab Apps, and a person whose roles grant no app sees an empty Apps page.

## Check the result

Open the profile of a person who has the role and expand the section Roles / Permissions, which counts the apps, widgets, agents and prompts that the person's roles grant, or sign in as such a person and open a dashboard that uses the widgets. The roles that a person holds are listed in the table of users, and a role's members are shown as avatars in the table of roles.

## Remove access

Set the backend and its widgets to No Access and save. Dashboards that already use the widgets keep them, and the widgets stop showing data for people who no longer have access.

The grants of several roles add up: a person may use a widget when any one of their roles allows it.
