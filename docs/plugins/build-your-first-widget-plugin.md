---
title: Build your first widget plugin
sidebar_position: 5
---

# Build your first widget plugin

In this lesson you add a new kind of widget to your FINOS Workspace. A widget plugin is a small package of files that teaches FINOS Workspace to draw a type of widget that it does not know. You write a plugin that draws a list of rows as a table, you put it through the review that every plugin passes, and you use it in a dashboard. When you finish, a widget of a type that you invented shows the data of your backend.

## What you need

You need the FINOS Workspace that [Run FINOS Workspace on your machine](../technical-guide/build-from-source/run-the-stack-from-source.md) starts, with its administrator signed in, and the backend of [Connect a backend and build a dashboard](../technical-guide/build-a-backend/connect-a-backend-and-build-a-dashboard.md), connected under the name Sales demo. You also need a text editor and a terminal that is in the folder of the repository, next to `docker-compose.yml`.

A plugin never arrives through the app. The person who runs a deployment places its files on the server, a superuser reviews them and approves them, and an administrator of an organization enables the plugin and says who may use it. Because you run your own FINOS Workspace, you do all of these parts, in that order.

## Write the package

Choose a folder outside the repository for the lesson, and make the folder of the package in it:

```bash
mkdir -p ~/workspace-plugin-tutorial/packages/row-table/1.0.0
```

The package of a plugin lives in a folder named `<plugin id>/<version>`. Put the module of the plugin in it, in a file named `entry.js`. The module is the code that draws the widget:

```js
export default {
  render({ model, el }) {
    const draw = () => {
      const rows = model.get("data");
      el.replaceChildren();
      if (!Array.isArray(rows) || rows.length === 0) {
        el.textContent = "No rows to show.";
        return;
      }
      const columns = Object.keys(rows[0]);
      const table = document.createElement("table");
      const head = table.createTHead().insertRow();
      for (const column of columns) {
        const cell = document.createElement("th");
        cell.textContent = column;
        head.appendChild(cell);
      }
      const body = table.createTBody();
      for (const row of rows) {
        const line = body.insertRow();
        for (const column of columns) {
          line.insertCell().textContent = String(row[column] ?? "");
        }
      }
      el.appendChild(table);
    };
    model.on("change:data", draw);
    draw();
    return () => model.off("change:data", draw);
  },
};
```

FINOS Workspace calls `render` with two things. The `el` is the element that the widget fills, and the `model` holds the values that FINOS Workspace hands to the widget. The value `data` is what the widget's backend endpoint returned, so a list of objects that all have the same keys arrives as an array. The function draws the table, draws it again whenever `data` changes, and returns a function that stops listening when FINOS Workspace removes the widget.

Next to it, in `plugin.json`, put the manifest that describes the plugin:

```json
{
  "manifestVersion": 1,
  "id": "row-table",
  "version": "1.0.0",
  "name": "Row table",
  "description": "Draws a JSON list of objects as a plain table.",
  "publisher": { "name": "Example Publisher" },
  "host": { "api": 1, "afm": "0.11" },
  "entry": { "module": "entry.js" },
  "contributes": {
    "widgets": [
      {
        "id": "table",
        "name": "Row table",
        "description": "A table of the rows that the backend returns",
        "category": "Tables",
        "handles": [
          {
            "type": "rowtable",
            "response": {
              "accepts": "json",
              "description": "A JSON list of objects that all have the same keys."
            }
          }
        ],
        "permissions": ["core:data:read"],
        "grid": { "w": 20, "h": 12 }
      }
    ]
  }
}
```

The manifest says who the plugin is and which widget it offers. The list `handles` names the widget type that the plugin draws, `rowtable`, which a backend uses in its `widgets.json`, and it says what the endpoint has to return. The permission `core:data:read` lets the widget read `data`, and a widget gets no permission that it does not ask for. [Plugin package and manifest](reference/package-and-manifest.mdx) describes every key.

## Give the server the package

The API reads plugins from one folder in its container, and it ignores plugins until the setting `WIDGET_PLUGINS_DIR` names that folder. Make a second file in the folder of the lesson, `~/workspace-plugin-tutorial/compose.plugins.yml`, that adds the setting and the mount to the API's service:

```yaml
services:
  api:
    environment:
      WIDGET_PLUGINS_DIR: /opt/widget-plugins
    volumes:
      - ${HOME}/workspace-plugin-tutorial/packages:/opt/widget-plugins:ro
```

Start the stack again with this file added to the one that starts it. Compose recreates the API's container and leaves the rest as it is:

```bash
docker compose -f docker-compose.yml -f "$HOME/workspace-plugin-tutorial/compose.plugins.yml" up -d
```

The mount is read-only, because the API only reads the folder.

## Check the package

The server has its own validator, which runs the checks that the server applies to a plugin and reports what it would refuse. Run it in the API's container, on the folder of your package as the container sees it:

```bash
docker compose -f docker-compose.yml -f "$HOME/workspace-plugin-tutorial/compose.plugins.yml" \
  exec api python -m scripts.plugin_check /opt/widget-plugins/row-table/1.0.0
```

The validator refuses the package and tells you why:

```text
row-table@1.0.0
  files     2
  checksum  sha256-<a value that starts with sha256->
  digest    sha256-<another value>
  error     checksum: Field required
blocked: the server would not offer this version for approval
```

A manifest has to carry the checksum of the files that it describes, so that nobody can change them after the review. Copy the value that the validator printed after `checksum` and add it to `plugin.json`, as a new line below `host`:

```json
  "checksum": "sha256-<the value that the validator printed>",
```

Run the validator again. This time it ends with `ok: the server would offer this version for approval`. The checksum covers every file except `plugin.json`, so if you change `entry.js` later, you print the checksum again.

## Review and approve the plugin

Open the main menu and choose Admin Portal. In the admin area select Widgets, and then the tab Deployment. It says that the deployer placed the packages in the plugins directory and that a new plugin does nothing until you approve it. Select Rescan. A message says "Rescanned: 1 discovered", and the table lists Row table with the status disabled and the version 1.0.0 as discovered.

Select the plugin. The page shows what the review found: who published the plugin, a line "as the package states it; not verified", the version's digest and that the checksum matches the manifest, the files that browsers receive, and that the frame has no network access and the plugin runs no code on the server. The part What it asks for lists every request that the version makes: its widget, its permission `core:data:read` and its code. Tick each one to say that you have read it, tick the box that says that you take responsibility for trusting the version, and select Approve 1.0.0. A message says "Row table 1.0.0 approved", and the plugin is enabled at the deployment.

An approved plugin is available to nobody until an organization enables it. On the same page, under Enabled for, turn on the switch of your organization.

Then give the plugin to a role. Select Roles and Access in the admin sidebar and open the action Widget plugins of a role that you hold, such as Agent User. The dialog lists Row table. Tick All widgets of this plugin and select Save. A message says "Widget plugin access saved". Nobody has access to a plugin except through a role, so this step cannot be skipped.

## Use the widget

A backend that declares a widget of the type `rowtable` can now use your plugin. Add a widget to the `widgets` of the backend from the earlier lesson, above the line `};` that ends the object:

```js
  orders: {
    name: "Orders",
    description: "The latest orders, one row for each",
    category: "Sales",
    type: "rowtable",
    endpoint: "/orders",
  },
```

Add `"/orders"` to the list in `const routes`, and add the route that answers it, above the route for `/notes`:

```js
  if (url.pathname === "/orders") {
    const orders = [
      { id: 1, region: "East", total: 10.5 },
      { id: 2, region: "West", total: 4 },
      { id: 3, region: "North", total: 7.25 },
    ];
    return send("application/json", JSON.stringify(orders));
  }
```

Stop the backend with Ctrl+C and start it again with `node backend.mjs`. Select Connections in the sidebar and select the refresh button beside Connect Backend. The row of Sales demo now shows 4 widgets.

Open a dashboard, select the round button at its bottom right that opens the Widget Menu, and type Orders into the search box. Select it and add it. The card first shows nothing, because the plugin loads in a frame of its own, and a moment later it shows your table with the three orders. FINOS Workspace asked the backend's endpoint for the rows, passed them to your module as `data`, and your code drew them.

## Where to go next

You wrote a plugin, checked it, put it through the review and used its widget. The table is plain because your module draws no styles. [How to style a plugin widget for both themes](style-a-plugin-widget.md) shows how to follow the site's light and dark themes. To let a person export the rows, read [How to add an export to a plugin widget](add-an-export-to-a-plugin.mdx). The module's contract is on [Plugin module contract](reference/module-contract.mdx), and [About widget plugins](widget-plugins.md) explains why plugins pass through a review at all. The folder `docs/examples` of the repository holds two complete plugins, one of which draws charts with a charting library.
