---
title: Build your first widget plugin
sidebar_position: 5
---

# Build your first widget plugin

Write a plugin that draws rows as a table, put it through the review that every plugin passes, and use it on a dashboard. At the end, a widget of a type that you invented shows the data of your backend.

## Before you start

You need:

- The FINOS Workspace that [Run the stack from source](../build-from-source/run-the-stack-from-source.md) starts, with its administrator signed in.
- The backend of [Connect a backend and build a dashboard](../build-a-backend/connect-a-backend-and-build-a-dashboard.mdx), connected as **Sales demo**.
- A text editor, and a terminal in the repository folder, next to `docker-compose.yml`.

:::note

A plugin never arrives through the app. The person who runs a deployment places its files on the server, a superuser approves them, and an organization admin enables the plugin and says who may use it. Because you run your own FINOS Workspace, you do all three, in that order.

:::

## 1. Write the module

Make a folder for the lesson, outside the repository, and a folder for the package in it:

```bash
mkdir -p ~/workspace-plugin-tutorial/packages/row-table/1.0.0
```

A package lives in `<plugin id>/<version>`. In that folder, create `entry.js`. It is the code that draws the widget:

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

FINOS Workspace calls `render` with two things:

- `el` is the element that the widget fills.
- `model` holds the values that FINOS Workspace hands to the widget. `data` is what the widget's backend endpoint returned, so a list of objects with the same keys arrives as an array.

The function draws the table, draws it again whenever `data` changes, and returns a function that stops listening when FINOS Workspace removes the widget.

## 2. Write the manifest

Next to `entry.js`, create `plugin.json`:

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

The manifest says who the plugin is and which widget it offers:

- `handles` names the widget type that the plugin draws, `rowtable`. A backend uses that type in its [`widgets.json`](../../reference/schemas/widgets-json.mdx). It also says what the endpoint has to return.
- [`core:data:read`](../../reference/plugins/commands-and-permissions.mdx) lets the widget read `data`. A widget gets no permission that it does not ask for.

[Plugin package and manifest](../../reference/plugins/package-and-manifest.mdx) describes every key.

## 3. Give the server the package

The API reads plugins from one folder in its container, and it ignores plugins until `WIDGET_PLUGINS_DIR` names that folder.

1. Create `~/workspace-plugin-tutorial/compose.plugins.yml`:

   ```yaml
   services:
     api:
       environment:
         WIDGET_PLUGINS_DIR: /opt/widget-plugins
       volumes:
         - ${HOME}/workspace-plugin-tutorial/packages:/opt/widget-plugins:ro
   ```

2. Start the stack again with this file added. Compose recreates the API's container and leaves the rest as it is:

   ```bash
   docker compose -f docker-compose.yml -f "$HOME/workspace-plugin-tutorial/compose.plugins.yml" up -d
   ```

The mount is read-only, because the API only reads the folder.

## 4. Check the package

The server has its own validator. It runs the checks that the server applies to a plugin and reports what it would refuse. Run it in the API's container, on your package as the container sees it:

```bash
docker compose -f docker-compose.yml -f "$HOME/workspace-plugin-tutorial/compose.plugins.yml" \
  exec api python -m scripts.plugin_check /opt/widget-plugins/row-table/1.0.0
```

The validator refuses the package, and it tells you why:

```text
row-table@1.0.0
  files     2
  checksum  sha256-<a value that starts with sha256->
  digest    sha256-<another value>
  error     checksum: Field required
blocked: the server would not offer this version for approval
```

A manifest has to carry the checksum of its files, so that nobody can change them after the review. To fix it:

1. Copy the value printed after `checksum`.
2. Add it to `plugin.json`, as a new line below `host`:

   ```json
     "checksum": "sha256-<the value that the validator printed>",
   ```

3. Run the validator again. It now ends with `ok: the server would offer this version for approval`.

:::tip

The checksum covers every file except `plugin.json`. If you change `entry.js` later, print the checksum again.

:::

## 5. Approve the plugin

1. Open the main menu and choose **Admin Portal**.
2. Select **Widgets**, then the **Deployment** tab. The page says that a new plugin does nothing until you approve it.
3. Select **Rescan**. A message says "Rescanned: 1 discovered". The table lists **Row table** with the status disabled and the version 1.0.0 as discovered.
4. Select the plugin. The page shows what the review found:
   - who published the plugin, with the line "as the package states it; not verified",
   - the version's digest, and that the checksum matches the manifest,
   - the files that browsers receive,
   - that the frame has no network access and that the plugin runs no code on the server.
5. Under **What it asks for**, tick each request that the version makes: its widget, its permission `core:data:read` and its code.
6. Tick the box that says you take responsibility for trusting the version. Select **Approve 1.0.0**.

A message says "Row table 1.0.0 approved", and the plugin is enabled at the deployment.

## 6. Enable the plugin and give it to a role

An approved plugin is available to nobody until an organization enables it and a role grants it.

1. On the same page, under **Enabled for**, turn on the switch of your organization.
2. In the admin sidebar, select **Roles and Access**.
3. Open the **Widget plugins** action of a role that you hold, such as Agent User. The dialog lists **Row table**.
4. Tick **All widgets of this plugin** and select **Save**.

A message says "Widget plugin access saved".

:::note

Nobody has access to a plugin except through a role, so you cannot skip step 6.

:::

## 7. Use the widget

A backend that declares a widget of the type `rowtable` can now use your plugin.

1. In the `widgets` of the backend from the earlier lesson, above the line `};` that ends the object, add:

   ```js
     orders: {
       name: "Orders",
       description: "The latest orders, one row for each",
       category: "Sales",
       type: "rowtable",
       endpoint: "/orders",
     },
   ```

2. Add `"/orders"` to the list in `const routes`.
3. Add the route that answers it, above the route for `/notes`:

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

4. Stop the backend with Ctrl+C and start it again with `node backend.mjs`.
5. Select **Connections** in the sidebar, then the refresh button beside **Connect Backend**. The row of **Sales demo** now shows 4 widgets.
6. Open a dashboard. Select the round button at its bottom right that opens the Widget Menu, and type `Orders` in the search box. Select the widget and add it.

The card first shows nothing, because the plugin loads in a frame of its own. A moment later it shows your table with the three orders. FINOS Workspace asked the backend for the rows, passed them to your module as `data`, and your code drew them.

## Next steps

- [Style a plugin widget for both themes](style-a-plugin-widget.md): your table is plain because the module draws no styles.
- [Add an export to a plugin widget](add-an-export-to-a-plugin.mdx): let people export the rows.
- [Plugin module contract](../../reference/plugins/module-contract.mdx): everything that a module can do.
- [Plugin](../../concepts/plugin.md): what a plugin is.
- The folder `docs/examples` of the repository holds three complete plugins, two of which draw charts and tables with libraries.
