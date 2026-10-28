---
title: Connect a backend and build a dashboard
sidebar_position: 1
---

# Connect a backend and build a dashboard

In this lesson you give FINOS Workspace some data, put it on a dashboard, change what a widget shows, and save the dashboard as an app. You write the data source yourself, a small program, so that you see exactly what FINOS Workspace asks of a backend. When you finish, you will have a dashboard with two widgets and an app that anyone in your organization can open again.

## What you need

You need a running FINOS Workspace and an account that can add connections, which means an Admin or a Developer. [Run FINOS Workspace on your machine](../build-from-source/run-the-stack-from-source.md) gives you both. You also need Node.js on the same computer, to run the backend that you write. Any recent version works, because the program uses only the modules that Node includes.

## Write the backend

A backend is a web server that describes its widgets in a file named `widgets.json` and answers a request for each widget's data. The web app calls the backend directly from your browser, so the backend runs on an address that your browser can reach and it has to allow the web app's address to call it.

Create a file named `backend.mjs` in an empty directory and put this program in it:

```js
import { createServer } from "node:http";

const APP_ORIGIN = "http://localhost:3000";

const widgets = {
  revenue_by_region: {
    name: "Revenue by region",
    description: "Revenue in millions of dollars for each sales region in one year",
    category: "Sales",
    type: "markdown",
    endpoint: "/revenue",
    params: [{ paramName: "year", type: "number", label: "Year", value: 2025 }],
  },
  sales_notes: {
    name: "Sales notes",
    description: "Notes from the sales team",
    category: "Sales",
    type: "markdown",
    endpoint: "/notes",
  },
};

const revenue = {
  2024: { East: 110, West: 90, North: 70 },
  2025: { East: 120, West: 95, North: 82 },
};

const routes = new Set(["/widgets.json", "/apps.json", "/revenue", "/notes"]);

function table(rows) {
  return [
    "| Region | Revenue ($M) |",
    "|---|---|",
    ...Object.entries(rows).map(([region, value]) => `| ${region} | ${value} |`),
  ].join("\n");
}

createServer((request, response) => {
  const url = new URL(request.url, "http://localhost:9100");
  response.setHeader("Access-Control-Allow-Origin", APP_ORIGIN);

  if (request.method === "OPTIONS") {
    return response.writeHead(routes.has(url.pathname) ? 204 : 404).end();
  }

  const send = (type, body) => response.writeHead(200, { "Content-Type": type }).end(body);

  if (url.pathname === "/widgets.json") return send("application/json", JSON.stringify(widgets));
  if (url.pathname === "/apps.json") return send("application/json", "[]");
  if (url.pathname === "/revenue") {
    const year = url.searchParams.get("year") ?? "2025";
    return send("text/markdown", revenue[year] ? table(revenue[year]) : `No data for ${year}.`);
  }
  if (url.pathname === "/notes") {
    return send("text/markdown", "## Notes\n\n- The East region leads in both years.\n- The North region grew fastest.");
  }
  response.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ detail: "not found" }));
}).listen(9100, () => console.log("Backend on http://localhost:9100"));
```

The program has three parts. The object `widgets` is the contents of `widgets.json`: each key is a widget's id, and each value gives the widget a name, a description, a category for the catalog, a type, and the endpoint that serves its data. The widget `revenue_by_region` also declares one parameter, `year`, with the starting value 2025. The server answers `/widgets.json` with that object, `/apps.json` with an empty list because this backend has no apps, and the two widget endpoints with Markdown text. The line that sets `Access-Control-Allow-Origin` is what lets the web app at `http://localhost:3000` call the backend, and the `OPTIONS` branch answers the browser's checks for a route with 204 when the route exists and 404 when it does not, which FINOS Workspace uses to verify a backend's routes.

Start the backend:

```bash
node backend.mjs
```

It prints `Backend on http://localhost:9100`. Leave it running. [widgets.json](../reference/schemas/widgets-json.mdx) lists everything that a widget definition may contain, and [Widget requests](../reference/protocols/widget-requests.mdx) describes the requests that the web app makes from it.

## Connect the backend

Sign in to FINOS Workspace and select Connections in the sidebar. The page says that no connections have been added. Select Connect Backend and fill in the dialog:

1. In Name, type `Sales demo`.
2. In Endpoint URL, type `http://localhost:9100`.
3. Leave Validate widgets at No. Setting it to Yes makes the test also check that the browser can reach every route that the widgets use.
4. Select Test.

The dialog reports "Test successful" and says that it found 2 widgets, 0 apps and 0 prompts. If the test fails, check that `backend.mjs` is still running and that `APP_ORIGIN` holds the address that you use to open FINOS Workspace, character for character. Select Add. The Connections page now lists Sales demo as an active connection with two widgets.

## Create a dashboard

Select Create Dashboard under My Dashboards in the sidebar, or the plus sign next to the heading. FINOS Workspace creates a dashboard with a generated name, such as "Sapphire Hairstreak", and opens it. The dashboard is empty, and it offers three ways to start: add widgets, browse apps, or add your own files.

Select Add widgets. The Widget Menu opens on the Widgets Library tab. The catalog lists the built-in Iframe and Navigation Bar widgets under Others, and your two widgets under the category Sales that you named in `widgets.json`. Select the checkbox of the Sales group to choose both widgets, and then select Add widgets.

The dashboard now shows two widgets. Revenue by region is a table of the regions with their revenue for 2025, and it has a box in its header that holds the year. Sales notes shows the notes as formatted text.

## Change a parameter

The box in the header of Revenue by region is the parameter that you declared, and FINOS Workspace labels it Year when it is empty. Change it to `2024` and press Enter. The widget asks the backend again, this time with `year=2024`, and the table shows 110, 90 and 70. You can confirm the request in the network tab of your browser.

## Name the dashboard

Right-click the dashboard in the sidebar, or select the three dots that appear next to it, and choose Rename. Type `Sales overview` and press Enter. A message confirms that the dashboard was renamed, and the sidebar shows the new name.

## Save the dashboard as an app

An app is a dashboard that you can reuse: it remembers which widgets are on it, how they are arranged and the values of their parameters. Open the dashboard's menu again and choose Save App. The dialog proposes the dashboard's name. Type a description, such as `Revenue by region and the sales team's notes.`, and select Save. A message says that the app was created, and the Apps page now shows a card for it with the number of widgets that it holds.

Select the card. FINOS Workspace creates a new dashboard from the app, with the widgets in the same places and the year at 2024, and opens it.

## Where to go next

You connected a backend, built a dashboard from its widgets and saved it as an app. To let other people see the dashboard, read [How to share a dashboard](../../user-guide/sharing/share-a-dashboard.md). To control who may use the backend's widgets, read [How to give a role access to data](../../user-guide/administration/give-a-role-access-to-data.md). To ask the AI agent about your dashboard, continue with [Ask the Copilot about a dashboard](../../user-guide/copilot/ask-the-copilot-about-a-dashboard.md).
