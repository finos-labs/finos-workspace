---
title: Widget rows
sidebar_position: 3
---

# Widget rows

Some widgets draw a view from data, for example an HTML page or a plugin's chart. Such a widget can also answer with the data itself, as rows, so that the AI Agent, MCP clients and the user can read what the view shows. The key `raw` enables this, and it is available on `html` widgets and on every plugin type.

```json
{
  "monthly_sales": {
    "name": "Monthly sales",
    "description": "Sales per month, by series",
    "type": "plotly",
    "endpoint": "/charts/monthly-sales",
    "raw": true,
    "data": { "dataKey": "results.chart", "rawDataKey": "results.records" }
  }
}
```

## How it works

When the host needs the rows, it sends the widget's own request again, with the widget's current parameters and with `raw=true` in the query, as [Widget requests](widget-requests.md) describes. The widget's endpoint can therefore decide whether to answer with a view or with rows.

The host reads the rows from the path in `data.rawDataKey`, which works like `dataKey`. Without `rawDataKey`, it reads the `results` field of the response, and when there is none it uses the whole response. One endpoint can answer both requests with a single document, such as `{"results": {"chart": {...}, "records": [...]}}`.

When `raw` is set, the AI Agent and MCP clients receive the rows and never the HTML or the chart. This applies to the widget's data in the Copilot and to the tools `get_widget_data` and `read_widget`. The agent loads a list of objects as a table that it can query.

The card gets a database button that switches between the widget's view and its rows, and the widget remembers the choice. If the user may use the plugin that `data.rawType` names, that plugin shows the rows. Otherwise an `html` widget shows the rows as a table, and the plugin of a plugin type shows them itself, as [Plugin module contract](../plugins/module-contract.mdx) describes.

## Rules

The keys `data.rawDataKey` and `data.rawType` are valid only together with `"raw": true`. The value of `rawType` is a type name that matches `^[a-z][a-z0-9_-]{1,31}$`. The name `raw` is a reserved query parameter name for these types, so a widget cannot use it for a parameter of its own.

## Where the code is

The function `rowsOf` in `frontend/src/lib/utils/rawRows.ts` reads the rows for every caller. The hook `useRawRows` and the components `RowsToggle` and `RowsTable` serve the html and plugin widgets, and `useRowsPlugin` finds the plugin that `rawType` names. The function `getCustomWidgetsData` asks a widget that has `raw` for its rows.
