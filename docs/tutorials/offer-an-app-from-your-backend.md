---
title: Offer an app from your backend
sidebar_position: 4
---

# Offer an app from your backend

In this lesson your backend offers a ready-made dashboard. An app is a dashboard that comes with a backend: it lists the widgets, where each one sits and what it starts with, and a user opens it with one click on the Apps page. You extend the backend from [Connect a backend and build a dashboard](connect-a-backend-and-build-a-dashboard.md) so that it offers an app, and you open the app. When you finish, the backend has an app card that creates a two-widget dashboard, with the year already set and with a question ready for the Copilot.

## What you need

You need the backend of the previous lesson, the file `backend.mjs`, running and connected to your Workspace under the name Sales demo. You also need a signed-in browser. The Copilot part at the end needs an AI agent, which [Run Workspace on your machine](run-workspace-on-your-machine.md) starts, and you can skip that part without losing anything else.

## Describe the app

An app is an object in a file named `apps.json`, which the backend serves at the same address as `widgets.json`. Open `backend.mjs` and add this constant above the line that begins `const routes`:

```js
const apps = [
  {
    name: "Regional sales",
    description: "Revenue by region next to the notes of the sales team.",
    templateId: "regional-sales",
    prompts: ["Which region has the highest revenue?"],
    tabs: {
      overview: {
        id: "overview",
        name: "Overview",
        layout: [
          { i: "revenue_by_region", x: 0, y: 0, w: 20, h: 12, state: { params: { year: 2024 } } },
          { i: "sales_notes", x: 20, y: 0, w: 20, h: 12 },
        ],
      },
    },
  },
];
```

Then change the line that answers `/apps.json`, which until now answered with an empty list, so that it answers with the app:

```js
  if (url.pathname === "/apps.json") return send("application/json", JSON.stringify(apps));
```

The app has four parts:

- **The card.** `name` and `description` are what the card on the Apps page shows. `templateId` is a name for the app that never changes, which roles use to grant the app to people, so choose it once.
- **The question.** `prompts` is a list of questions that the Copilot suggests to the person who works on a dashboard from this app.
- **The tabs.** A dashboard has one tab for each entry of `tabs`. This app has one, named Overview.
- **The layout.** Each item names a widget by its id in `i` and places it on a grid that is 40 columns wide: `x` and `y` are the position, and `w` and `h` are the width and the height. The two widgets are 20 columns wide, so they sit side by side. The `state` of the first one sets its parameter `year` to 2024, in place of the 2025 that the widget starts with otherwise.

Stop the backend with Ctrl+C in its terminal and start it again:

```bash
node backend.mjs
```

[apps.json](../reference/schemas/apps-json.mdx) lists everything that an app may contain.

## Refresh the connection

Workspace reads the apps of a backend when it connects the backend and when it refreshes it. Select Connections in the sidebar, and select the refresh button, which is the one with two arrows beside Connect Backend. A message says "Backends refreshed", and the row of Sales demo now shows 1 under Apps.

## Open the app

Select Apps in the sidebar. The page lists the apps of all your connections, and it has a card for Regional sales. The card shows the name of the connection, Sales demo, the name of the app and its description. Its footer shows 2, the number of widgets, and 1, the number of suggested questions.

Select the card. Workspace creates a dashboard named Regional sales and opens it. It has the two widgets side by side, Revenue by region on the left and Sales notes on the right. The table of Revenue by region shows 110, 90 and 70, which are the values of 2024, because the app set the year.

## Look at the suggested question

Open the Copilot, which is the panel on the right of a dashboard, and start a new chat. The empty chat says "Get started with these suggested prompts for this dashboard" and shows the question from your app, "Which region has the highest revenue?". Select it to ask it, as [Ask the Copilot about a dashboard](ask-the-copilot-about-a-dashboard.md) shows.

## Where to go next

You made your backend offer a dashboard. To give the app to some people and not to others, read [How to give a role access to data](../how-to/administer/give-a-role-access-to-data.md), which grants an app by its `templateId`. To check a backend that does not show what you expect, read [How to review and debug a backend](../how-to/build/review-and-debug-a-backend.md). To turn a dashboard that you built by hand into an app file, read [How to export a dashboard as an app](../how-to/build/export-a-dashboard-as-an-app.mdx).
