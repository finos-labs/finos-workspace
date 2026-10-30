---
title: Browse and open apps
sidebar_position: 1
---

# Browse and open apps

This guide finds an app on the Apps page and opens it as a dashboard. An app is a template: it remembers which widgets to place, where, and with which parameter values. [App](../../concepts/app.md) says what an app is.

## Find an app

1. Select **Apps** in the sidebar.
2. Look through the cards. The page lists the apps that you saved, and the apps that your backends and your organization provide. Each card shows the name and the description of the app, the number of widgets and the number of prompts. A card of an app that you saved has the tag **Saved App**.
3. To narrow the list, use the search box, the filters for the backend and the app, and the sort menu. The refresh button loads the list again.

## Open an app

1. Select the card of the app.

FINOS Workspace creates a new dashboard from the app, with the widgets in the same places and with the same parameter values, and it opens the dashboard. The dashboard has the name of the app. When you already have a dashboard from the same app, the new one gets a number in brackets, for example `Sales overview (2)`.

When you select the card of an app again and you have not changed the dashboard that you opened from it, FINOS Workspace opens that dashboard instead of creating another.

When the app has suggested prompts, the Agent panel lists them for the new dashboard.

## What the dashboard keeps from the app

The dashboard is yours. You can change its parameters, rearrange its widgets, add and remove widgets, and save it as an app of your own. A change to the dashboard does not change the app. Only **Update existing app** changes the app, as [Save a dashboard as an app](save-a-dashboard-as-an-app.mdx#update-an-app-instead-of-creating-another) describes.

An app can lock the dashboards that are made from it. On a locked dashboard you cannot add, remove, duplicate or move widgets, and you cannot edit the tabs of its Navigation Bar. You can still change the parameters of the widgets, switch between tabs and resize widgets. A copy of a locked dashboard is locked too, and so is every further dashboard that you open from the app.

## Where the apps come from

- A backend lists its apps in a file named `apps.json`. [App behavior](app-behavior.md) describes what FINOS Workspace does with such an app.
- You save a dashboard of your own as an app, as [Save a dashboard as an app](save-a-dashboard-as-an-app.mdx) describes.
- An app that you or somebody else shared appears on the Apps page of the people who have access. [Share a dashboard](../sharing/share-a-dashboard.md#share-an-app) describes how to share an app.
