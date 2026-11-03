---
title: The building blocks
sidebar_position: 1
---

# The building blocks

FINOS Workspace is built from widgets, dashboards and apps. A widget shows data from one source. A dashboard arranges widgets. An app is a template for dashboards.

| | What it is | Where it lives | Who owns it |
|---|---|---|---|
| Widget | A view of one source | The backend's `widgets.json` | The backend |
| Dashboard | An arrangement of widgets | The FINOS Workspace API | One person |
| App | A template for dashboards | A backend's `apps.json`, or saved by a person | The backend, or the person who saved it |

## Widget

A widget shows what one source returns. The source is usually an endpoint of a data backend. It can also be a file that a person uploaded, or something that FINOS Workspace provides itself, such as an embedded web page.

A widget's definition says:

- where the data comes from,
- what the person can change. These are the parameters, such as a year or a team,
- how the data is drawn. This is the type, such as a Markdown table, an HTML page, or a chart that a plugin draws.

The backend owns the definition and lists it in its `widgets.json`. A widget is only a catalog entry until someone puts it on a dashboard.

The Widget Menu lists the catalog entries, grouped by the category that the backend gave them. The Agent searches the same entries by name and description. So the author of a backend decides how a widget is described and what it can be asked. FINOS Workspace needs to know nothing about the data.

## Dashboard

When a person adds a widget to a dashboard, it becomes a card. A card has its own state:

- its size and place on the grid,
- the values of its parameters,
- the settings that its type keeps.

The same catalog entry can be on many dashboards, or several times on one. Each card keeps its own values.

A dashboard has a grid that is 40 columns wide and one or more tabs. It can link parameters of different cards, so that a change in one card moves the others.

A dashboard stores the arrangement and the values, not the data. Each time someone opens it, the browser asks the backends again, so a dashboard is small and shows current data.

A dashboard belongs to one person. The FINOS Workspace API stores it and keeps older versions for a while. The browser holds the live copy while the person works.

## App

An app is a template for dashboards. It remembers which widgets to place, where, and with which parameter values and links. It can also carry suggested questions for the Agent.

Opening an app creates a new dashboard from it. The new dashboard belongs to the person who opened it, and that person can change it freely.

Apps come from two places:

- A backend offers them in its `apps.json`, so that the people who use the backend start from a good arrangement. [Offer an app from your backend](../tutorials/build-a-backend/offer-an-app-from-your-backend.mdx) builds these.
- A person saves a dashboard of their own as an app, to reuse it. [Save a dashboard as an app](../features/apps/save-a-dashboard-as-an-app.mdx) makes these.

Both kinds appear on the Apps page. A saved one carries the tag Saved App.

## Sharing and access

Sharing a dashboard shares the arrangement, not the data. The recipient gets the cards, and each card asks its backend with the recipient's own credentials, never the owner's. A recipient who has no connection to the backend, and no role that gives it to them, sees a card that says so instead of data. [Roles and access](roles-and-access.md) explains how roles give access to backends, widgets and apps.

The parts are independent:

- A backend can change a widget without touching any dashboard, because dashboards hold only parameter values.
- A dashboard can be rearranged without touching the backend.
- An app can be passed around, shared and updated without moving any data.

[How a widget gets its data](how-widget-data-flows.md) follows one request from a card to a backend and back.
