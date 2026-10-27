---
title: About dashboards, widgets and apps
sidebar_position: 2
---

# About dashboards, widgets and apps

Three nouns carry most of what people see in FINOS Workspace: a widget, a dashboard and an app. They look like three layers of one thing, but they live in different places and they have different owners, and that is why sharing, access and data behave the way they do. This page says what each noun is, where it lives and how the three relate.

## A widget is a view of one source

A widget shows what one source returns. The source is usually an endpoint of a data backend, and it can also be a file that a person uploaded or something that FINOS Workspace provides itself, such as a page embedded in an iframe. The widget's definition says where the data comes from, what the person may change, and how it is drawn. The things that a person may change are the widget's parameters, such as a year or a team, and how it is drawn is its type, such as a table of Markdown, an HTML page or a chart that a plugin draws.

The definition belongs to the backend, which lists it in its `widgets.json`. Until somebody places it on a dashboard, a widget is only an entry in a catalog. The Widget Menu lists those entries, grouped by the category that the backend gave them, and the Copilot searches the same entries by their names and descriptions. This is why a backend's author decides how a widget is described and what it can be asked, and why FINOS Workspace itself needs to know nothing about the data.

## A dashboard is an arrangement of widgets

When a person adds a widget to a dashboard, it becomes a card with state of its own: its size and place on the grid, the values of its parameters, and any settings that its type keeps. The same catalog entry can appear on many dashboards, or on one dashboard several times, and each card keeps its own values. A dashboard arranges its cards on a grid that is 40 columns wide, in one or more tabs, and it can link parameters of different cards so that a change in one moves the others.

A dashboard stores no data from the backends. It stores the arrangement and the values, and each time somebody opens it, the browser asks the backends again. That keeps a dashboard small and always current, and it means that a dashboard is never wrong about what the data was, only about whether the person who opens it may reach the data. A dashboard belongs to one person. The FINOS Workspace API keeps it, and keeps older versions of it for a while, and the browser holds the live copy while the person works.

## An app is a dashboard that can be opened again

An app is a template for dashboards. It remembers which widgets to place, where, with which parameter values and links, and it may carry suggested questions for the Copilot. Opening an app does not show the app: it creates a new dashboard from it, which belongs to the person who opened it and which that person can change freely.

An app comes from one of two places. A backend may offer apps in its `apps.json`, so that the people who use the backend start from a good arrangement. A person may also save a dashboard of their own as an app, which is the quickest way to reuse something that took work to arrange. Both kinds appear on the Apps page, and the second kind carries the tag Saved App. [Offer an app from your backend](../tutorials/offer-an-app-from-your-backend.md) builds the first kind, and [How to save a dashboard as an app](../how-to/use/save-a-dashboard-as-an-app.mdx) makes the second.

## What follows for sharing and access

The split explains a rule that surprises people at first: sharing a dashboard shares the arrangement, and it does not share the data. The recipient receives the cards, and each card asks its backend with the recipient's own credentials, never with the owner's. A recipient who has no connection to the backend, and no role that gives it to them, sees a card that says so instead of data. [About roles and access](roles-and-access.md) explains how roles give access to backends, widgets and apps.

The same split keeps the parts independent. A backend can change a widget without touching any dashboard, because the dashboards hold only parameter values. A dashboard can be rearranged without touching the backend. An app can be passed around, shared and updated without moving any data. [About how a widget gets its data](how-widget-data-flows.md) follows one request from a card to a backend and back.
