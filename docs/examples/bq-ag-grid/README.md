# BQ AG Grid for Workspace

A Workspace widget plugin that draws the `bq-ag-grid` widget type with AG Grid Community 34.
Any backend whose `widgets.json` declares a widget of type `bq-ag-grid`, and whose endpoint
returns rows, is shown as a grid that sorts, filters, searches, pins, resizes, moves and
pages as AG Grid does, and groups, aggregates and pivots, once a Workspace deployment has
approved and enabled the plugin. It is an example in the repository's `docs/examples/`, a
package of its own that nothing in Workspace imports, built and deployed the way any
plugin is ([AUTHORING.md](../../widget-plugins/AUTHORING.md)), on the same lines as
[`plotly-charts`](../plotly-charts/README.md).

It is not the [`ag-grid`](../ag-grid/README.md) example, a different plugin with a widget
type of its own: the two install side by side, and a backend picks one by the type it
declares.

## The contract

The widget's endpoint returns one of two things.

**Rows**, a list of objects. The grid infers the columns, in the order the keys first
appear, and the type of each from its values: `number`, `boolean`, `dateString`
(`yyyy-mm-dd`), `object`, else `text`. Filters, sorting and alignment follow the type.

```json
[
  { "company": "Acme", "sector": "Energy", "revenue": 12.5, "listed": true, "founded": "1999-04-01" },
  { "company": "Bolt", "sector": "Finance", "revenue": 3.1, "listed": false, "founded": "2011-09-30" }
]
```

**A grid**, in AG Grid's own names: `rowData`, and optionally `columnDefs` and
`gridOptions`.

```json
{
  "rowData": [{ "company": "Acme", "sector": "Energy", "revenue": 12.5 }],
  "columnDefs": [
    { "field": "company", "pinned": "left" },
    { "field": "sector", "enableRowGroup": true, "rowGroup": true },
    { "field": "revenue", "headerName": "Revenue ($M)", "aggFunc": "sum",
      "valueFormat": { "style": "currency", "decimals": 1 } }
  ],
  "gridOptions": { "pagination": true, "paginationPageSize": 50 }
}
```

A backend declares the widget with its type and endpoint. Columns and grid options that
are the same for every response can be declared once, in the widget's `data["bq-ag-grid"]`
(the plugin's `definition`): Workspace checks them against the plugin's schema when it
reads the backend, and the AI agent reads that schema when it builds a grid widget. A
response that is a grid overrides them: its `columnDefs` replace the declared ones, and its
`gridOptions` are laid over them.

```json
{
  "daily_prices": {
    "name": "Daily prices",
    "type": "bq-ag-grid",
    "endpoint": "/prices",
    "data": {
      "bq-ag-grid": {
        "columnDefs": [
          { "field": "date", "valueFormat": { "style": "date" }, "sort": "desc" },
          { "field": "ticker", "enableRowGroup": true },
          { "field": "close", "aggFunc": "avg", "valueFormat": { "style": "currency", "decimals": 2 } }
        ],
        "gridOptions": { "pagination": true, "defaultColDef": { "floatingFilter": true } }
      }
    }
  }
}
```

Rows under a key of the response, such as `{"results": [...]}`, are read with the widget's
`dataKey`, as for any widget.

### What a column can say

A widget is JSON and the frame blocks `eval`, so a grid can only be declared, never
programmed: there are no `valueFormatter`, `cellRenderer` or `comparator` functions, and
no expressions in strings. A key the plugin does not support, or a value of the wrong
type, is not applied, and the card lists it under *options not applied*.

| Key | |
|---|---|
| `field` | The row key the column shows. Required. |
| `headerName`, `headerTooltip` | The header and its tooltip. Without `headerName`, the field in words (`revenueUsdM` is *Revenue Usd M*). |
| `cellDataType` | `text`, `number`, `boolean`, `date`, `dateString` or `object`. Inferred when left out. |
| `width`, `minWidth`, `maxWidth`, `flex` | Size. Columns flex by default. |
| `hide`, `pinned` (`left`, `right`), `sort` (`asc`, `desc`) | Where the column starts. The user can change them. |
| `sortable`, `filter`, `floatingFilter`, `resizable` | AG Grid's switches. `filter: true` picks the filter of the type: text, number or date. |
| `wrapText`, `autoHeight`, `wrapHeaderText` | Long values. |
| `valueFormat` | `{ "style": "decimal" \| "percent" \| "currency" \| "date", "decimals", "currency", "notation": "compact", "dateStyle" }`, in the user's locale. Without one, numbers show as they come, fractions rounded to the site's decimals. |
| `enableRowGroup`, `rowGroup`, `rowGroupIndex`, `aggFunc` | Grouping (below). |
| `enablePivot`, `pivot`, `pivotIndex` | The pivot table (below). |

A column group is `{ "headerName": "...", "children": [columns], "marryChildren": true }`.
`gridOptions` takes `pagination`, `paginationPageSize`, `paginationAutoPageSize`,
`rowHeight`, `headerHeight`, `animateRows`, `enableCellTextSelection`,
`suppressMovableColumns`, `suppressFieldDotNotation` (on unless set: keys with dots are
keys, not paths), `pivotMode`, `defaultColDef` (`sortable`, `filter`, `floatingFilter`, `resizable`,
`flex`, `minWidth`, `wrapHeaderText`) and `autoGroupColumnDef` (`headerName`, `field`,
`minWidth`). The manifest's `definition` is the full schema.

### Grouping

Row grouping and aggregation are AG Grid Enterprise features; this plugin uses AG Grid
Community, so the grouping is the plugin's own, read from AG Grid's column keys. A backend
that moves to Enterprise keeps its `columnDefs`.

- The user groups by the columns with `enableRowGroup`, in any order and at any depth, from
  the toolbar. The grid starts grouped by the columns with `rowGroup`, in `rowGroupIndex`
  order.
- Group rows show the count of their rows and, for each column with an `aggFunc` (`sum`,
  `avg`, `min`, `max`, `count`), the aggregate of their rows. Averages are of the rows, not
  of the subgroups. The toolbar can apply one function to every such column.
- `autoGroupColumnDef.field` labels the rows inside the groups; without it, the first text
  column does.
- Inferred columns: every text, boolean or date column can be grouped, and every number
  column is summed.
- While grouped, the search applies to the rows and the columns do not sort or filter;
  AG Grid's sorting and filters return when the grouping is removed.

### The pivot table

The pivot table is AG Grid Enterprise's pivot mode, made by this plugin from the same
keys. `gridOptions.pivotMode` starts the widget as one; otherwise the toolbar's **Pivot**
switch turns it on, for any widget with a column that can pivot.

- **Rows**: one per value of the row columns, the `rowGroup` columns to start with (any
  `enableRowGroup` column from the toolbar), with a pinned *Total* row.
- **Columns**: one per value of the pivot columns, the `pivot` columns in `pivotIndex`
  order to start with (any `enablePivot` column from the toolbar). Two pivot columns nest:
  *Large* over *CA*, *TX*... At most 100 values become columns; the header says how many
  more there are, and the totals count them.
- **Cells**: each `aggFunc` column's aggregate of the rows that have both values, in the
  column's `valueFormat`; the toolbar's Aggregate applies one function to all. Without an
  `aggFunc` column, each cell is the count of rows. A *Total* column follows.
- Inferred columns pivot as they group: any text, boolean or date column.
- The pivot table is a grid of its own: its columns sort and filter, the search picks the
  rows it is made of, and *Table as shown* exports it.

```json
"data": {
  "bq-ag-grid": {
    "columnDefs": [
      { "field": "sector", "enableRowGroup": true, "rowGroup": true },
      { "field": "size", "enablePivot": true, "pivot": true },
      { "field": "revenue", "aggFunc": "sum", "valueFormat": { "style": "currency" } }
    ],
    "gridOptions": { "pivotMode": true }
  }
}
```

### What the user keeps

The column order, widths, visibility and pinning, the sort, the filters, the page, the
grouping, the pivot, the aggregate and the search are saved with the dashboard (the `state` trait,
`core:state:write`), and restored when it opens.

### Exports and the agent

Workspace's Export menu offers the table as shown (CSV: the visible columns, sorted,
filtered and formatted, every page), all the rows (CSV) and the response (JSON). The
Copilot gets the columns and their types, how many rows there are and how many the view
keeps, the search, sort and filters, the first 20 rows, and when grouped, the top-level
groups with their counts and aggregates. As a pivot table, it gets the row, pivot and
value columns, the first 20 rows with their first 20 pivot values' cells named by value
(*Large · revenueUsdM (sum)*), and the totals.

### Rows of other widgets

A widget of any plugin type with `"raw": true` can name this grid for its rows,
`"data": { "rawType": "bq-ag-grid" }`: its rows button then shows them here. The example
backend's *Sales by month* is a Plotly chart that does.

## Build

Node 20 or later.

```bash
npm install
npm run build
```

The build bundles `src/entry.tsx` with esbuild, React and AG Grid Community included, into
`dist/bq-ag-grid/<version>/entry.js` (about 1.3 MB), and prints the checksum and the version
digest. `.npmrc` sets `legacy-peer-deps`, which works around an npm 10 error resolving the
test tools' optional peers.

`plugin_check` warns that the entry uses `new Function`. That is AG Grid's expression
service, which runs only for column definitions written as strings; this plugin never
passes one, so the frame's block on `eval` costs nothing.

## Test

```bash
npm run typecheck
npm test
```

The tests check reading responses and definitions (and that the manifest's schema declares
the keys the code reads), inferring types, the grouping, the pivot table, the search, the formats, the
saved state, the CSV and the agent context. Drawing needs a browser and is checked on a
dashboard.

## Try it

1. Build into the plugins directory of your local stack (`local/LOCAL_SETUP.md`, section
   Widget plugins): copy `dist/bq-ag-grid/<version>/` to
   `<plugins directory>/bq-ag-grid/<version>/`.
2. In Workspace, Admin, Widgets, Deployment: Rescan, review and approve the version, and
   enable it for your organization. Under Plugin widgets, enable it, and under Roles and
   Access grant it to a role you hold.
3. Start the example backend and connect it under Connections (below).
4. Add the *BQ AG Grid examples* widgets to a dashboard.

`examples/backend.py` needs only Python 3. It serves six widgets:

| Widget | Shows |
|---|---|
| *Companies (rows)* | 500 company rows as a plain list: every column inferred |
| *Companies (grid)* | The same rows as a grid: headers, a column group, formats, grouped by sector and state |
| *Companies (pivot table)* | The same endpoint as *Companies (rows)*, as a pivot table: revenue and employees by sector and size, declared in `widgets.json` |
| *Daily prices* | A year of prices for five tickers, with the columns and options declared in `widgets.json` |
| *Trades (20,000 rows)* | Twenty thousand inferred rows, paged |
| *Sales by month* | A `plotly` chart (needs `plotly-charts`) whose rows button shows its rows in this grid |

```bash
npm run demo-backend
```

It listens on `http://localhost:7779` and allows the Workspace web app at
`http://localhost:1420`, the local stack's; `python3 examples/backend.py <port> <web app
origin>` changes either.

### A second backend: the same widget, reused

`examples/hr_backend.py` is an unrelated backend, an HR directory, that uses the same
`bq-ag-grid` type and nothing else of the first: the plugin is not changed for it. It reuses
the grid three ways:

| Widget | Shows |
|---|---|
| *People* | Rows under a key (`{"results": [...], "count": n}`, read with `dataKey`), columns declared in `widgets.json`, grouped by office, and params that pick the rows on the server: a department and whether to include leavers. Add it twice to compare two departments side by side; each card keeps its own params, grouping and filters. |
| *Headcount by office* | Columns the response builds from the data, one per department under a column group, for the year a param picks. |
| *Team roster* | A team picker whose choices come from the backend (`optionsEndpoint`), the team in the path (`/teams/{team}/members`), every column inferred. |

```bash
npm run demo-hr-backend
```

It listens on `http://localhost:7780` and allows `http://localhost:1420`. Connect it under
Connections as a second backend.

To change the plugin on a local stack, start the next version on its Deployment page
(Patch, Minor or Major) and build into that version's directory: the app serves its files
as they are until you approve it. Anywhere else, every change is a new version: raise
`version` in `package.json` and build again.
