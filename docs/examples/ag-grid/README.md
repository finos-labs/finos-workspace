# AgGrid table for FINOS Workspace

A FINOS Workspace widget plugin that renders the `ag-grid` widget type with
[AG Grid](https://www.ag-grid.com/), configured the way
[OpenBB Workspace's table widget](https://docs.openbb.co/workspace/developers/widget-types/aggrid-table-charts)
is: column definitions, render functions, hover cards, sparklines and ChartView. It is an example in the repository's `docs/examples/`, a package of
its own that nothing in FINOS Workspace imports, built and deployed the way any
plugin is ([AUTHORING.md](../../widget-plugins/AUTHORING.md)).

## What it shows

The plugin renders tabular data returned by a backend as an ag-grid Community
table, with:

- **Column definitions**: `field`, `headerName`, `width`, `minWidth`, `maxWidth`,
  `flex`, `resizable`, `sortable`, `filter`, `editable`, `pinned`, `rowGroup`,
  `enablePivot`, `cellRenderer`, `cellEditor`, `valueGetter`, `valueSetter`,
  `cellClass`, `cellStyle`, `tooltip`, and more.
- **Grid options**: `rowSelection` (`single`/`multiple`), `rowMultiSelectWithClick`,
  `rowDeselection`, `pagination` / `paginationPageSize`, `domLayout`
  (`autoHeight`), `editing` (`singleCell`/`fullRow`), `enableRangeSelection`,
  `suppressContextMenu`, `animateRows`, `enableCellTextSelection`, `rowHeight`,
  `headerHeight`, `treeData`, `masterDetail`, and many others.
- **Streaming updates**: when the backend pushes new row data through the
  `data` trait, the widget computes an add/update/remove diff and applies it
  with `api.applyTransaction()` — efficient incremental updates without a full
  re-render. Falls back to `api.setRowData()` if transactions fail.
- **Grid events**: `selectionChanged`, `cellValueChanged`, `rowDataChanged`,
  `filterChanged`, `sortChanged`, `columnResized`, `columnMoved`, `cellClicked`
  are recorded to the widget's `state` trait (written back to the host via
  `model.save_changes()`) and exposed through `copilotContext()` so the AI
  agent can read them.
- **Export**: CSV export of the visible rows (`core:export:provide`).
- **Themes**: follows the site's `theme=dark` / `theme=light` using
  `ag-theme-quartz` / `ag-theme-quartz-dark`, in a compact density: 26 px rows, a 30 px header,
  formatted and right-aligned numbers, columns that share the card's width, and pagination only
  above 100 rows, with as many rows per page as fit.
- **Tool panels**: with `ag-grid-enterprise` loaded, a side bar with the Columns panel
  (visibility, row groups, values and Pivot Mode) and the Filters panel, drop zones for row
  groups and pivots, range selection and a status bar with the row count and the aggregate of
  the selected cells. Every column can be grouped, pivoted and aggregated, and a selected range
  is charted from the context menu (Chart Range: column, bar, pie, line, scatter, area, statistical
  and combination charts) in a dark or light chart theme that follows the site. A backend's
  `gridOptions` replace any of these defaults.

## The contract

The backend declares a widget of type `ag-grid` and returns JSON:

```json
{
  "sales": {
    "name": "Sales by region",
    "type": "ag-grid",
    "endpoint": "/sales"
  }
}
```

The endpoint returns JSON at the `dataKey` path. `dataKey` is set in
`widgets.json` as a dot-notation path into the API response (e.g.
`"results.grid"`). The host extracts the value at that path and delivers it to
the plugin through the `data` trait.

### 1. ag-grid-ready object (explicit column defs)

```json
{
  "columnDefs": [
    { "field": "region", "headerName": "Region", "width": 150 },
    { "field": "sales", "headerName": "Sales", "width": 100 }
  ],
  "rowData": [
    { "region": "EMEA", "sales": 100 },
    { "region": "APAC", "sales": 105 }
  ],
  "gridOptions": {
    "rowSelection": "multiple",
    "pagination": true,
    "paginationPageSize": 20
  }
}
```

### 2. List of records (pandas `to_dict('records')`)

```json
[
  { "region": "EMEA", "sales": 100, "date": "2024-01-10" },
  { "region": "APAC", "sales": 105, "date": "2024-01-12" }
]
```

Column definitions and types are inferred automatically from the data.

### 3. Dict of columns (pandas `to_dict('list')`)

```json
{
  "region": ["EMEA", "APAC"],
  "sales": [100, 105],
  "date": ["2024-01-10", "2024-01-12"]
}
```

### 4. Pandas split format

```json
{
  "columns": ["region", "sales", "date"],
  "index": [0, 1],
  "data": [["EMEA", 100, "2024-01-10"], ["APAC", 105, "2024-01-12"]]
}
```

### 5. Grouping

Column definitions in the ag-grid-ready object group rows. Here the `region` column is the row
group and is hidden as a column of its own:

```json
{
  "columnDefs": [
    { "field": "region", "rowGroup": true, "hide": true },
    { "field": "sales" }
  ],
  "rowData": [
    { "region": "EMEA", "sales": 100 },
    { "region": "APAC", "sales": 105 }
  ]
}
```

## Table chart configuration

An OpenBB backend's table widget moves over with two changes: `"type": "table"` becomes
`"type": "ag-grid"`, and `data.table` becomes `data["ag-grid"]`. The endpoint returns the same
rows. The plugin declares the object's schema (`definition` in `plugin.json`), so a backend whose
keys or values do not fit sees the problem, with its JSON pointer, when it connects.

```json
{
  "assets": {
    "name": "Assets",
    "description": "TVL by asset",
    "type": "ag-grid",
    "endpoint": "/assets",
    "data": {
      "ag-grid": {
        "enableCharts": true,
        "chartView": { "enabled": false, "chartType": "column" },
        "columnsDefs": [
          { "field": "name", "headerName": "Asset", "renderFn": "titleCase", "pinned": "left", "chartDataType": "category" },
          { "field": "tvl", "headerName": "TVL (USD)", "formatterFn": "int", "chartDataType": "series" },
          { "field": "change_1d", "headerName": "24h Change", "formatterFn": "percent", "renderFn": "greenRed" }
        ]
      }
    }
  }
}
```

| Key (as in OpenBB) | What the plugin does |
|---|---|
| `columnsDefs[]`: `field`, `headerName`, `headerTooltip`, `width`, `minWidth`, `maxWidth`, `hide`, `pinned`, `align` | The AG Grid column options of the same names. A column with `width` keeps it instead of sharing the card's width. |
| `cellDataType` (`text`, `number`, `boolean`, `date`, `dateString`, `object`) | The column's filter, alignment and formatting. Without it, the type is inferred from the rows. Date strings sort, filter and chart as dates and show as they came. |
| `formatterFn` (`int`, `none`, `percent`, `normalized`, `normalizedPercent`, `dateToYear`), on a column or the whole table; `decimalPlaces`; `prefix`, `suffix` | Formatted cell text. Sorting, filtering, charts and the CSV keep the raw values. Numbers follow the site's locale and decimals. |
| `renderFn` (one or a list) and `renderFnParams` | `greenRed`, `titleCase`, `columnColor` (`colorRules` with every condition, `fill`, `colorValueKey`), `hoverCard` (`cellField`, `title`, `markdown` with `{field}` placeholders, or `hoverCardData`), `cellOnClick` (below) and `showCellChange` (below). |
| `sparkline` (`line`, `area`, `bar`; `dataField`; `options`) | AG Grid sparklines: stroke, fill, opacity, markers, padding, bar `direction`, `min`/`max` for bars, every point of interest, and `customFormatter`. |
| `chartDataType` (`category`, `series`, `time`, `excluded`) | The column's role in charts. |
| `showAll` | Default `true`: fields the rows have and `columnsDefs` does not are shown after the declared ones. `false` shows only `columnsDefs`. |
| `transpose` | One row per column and one column per row, headed by the first column's values. Each cell keeps its column's format and colours. |
| `enableCharts`, `chartView` (`enabled`, `chartType`, `cellRangeCols`, `ignoreCellRange`, `chartNavigatorEnabled`, `chartMiniChartEnabled`) | A *Table / Chart* toolbar and an AG Grid integrated chart linked to the rows, with every chart type of OpenBB's list. The chart a user arranges is saved with the dashboard and restored, unless `ignoreCellRange`. Right-click *Chart Range* charts any selection. `enableCharts: false` turns charting off. |
| `enableAdvanced` | `true` opens the Columns panel; `false` hides the side bar. |
| `wsRowIdColumn` | The field that identifies a row across refreshes (default `id`), so changed rows are applied as transactions and `showCellChange` knows which cell moved. |

**Cell clicks** (`renderFn: "cellOnClick"`):

- `actionType: "groupBy"` writes `groupBy.paramName` (the cell's value, or the row's `valueField`) to the widget's params, which also updates every widget grouped with that param. The param must be one the widget declares in `widgets.json`. The widget always refetches, as with `forceUpdate: true`.
- `actionType: "openUrl"` opens the cell's value, or `renderFnParams.url` with `{field}` placeholders, after the user confirms. Only `https:` and `mailto:` links.
- `actionType: "sendToAgent"` fills `sendToAgent.markdown` from the row, copies it to the clipboard and keeps it in the widget's Copilot context. FINOS Workspace has no host command that sends a message to the AI agent, so the user pastes it.

**`showCellChange`**: when a refresh or `refetchInterval` brings new values, a changed cell flashes green when it rose and red when it fell (by `colorValueKey`'s field when set). `enableCellChangeWs: false` turns it off for a column.

**`customFormatter`** is a JavaScript function in a string. The frame forbids `eval`, and a backend's string should not run as code, so the plugin evaluates the subset formatters use, over the formatter's params only: `(params) => ({ ... })`, `params => { return {...} }` or `function (params) { return {...} }`, with literals, `params.x` and `params["x"]`, `! - + * / %`, comparisons, `&& || ??`, `?:` and `Math.abs/min/max/round/floor/ceil/sign`. Anything else is ignored with a console warning.

**Not supported:** `enableFormulas` (AG Grid formulas need AG Grid 34; this plugin uses 32), `min`/`max` on line and area sparklines (AG Grid 32 has no value domain for them), and the clickable links inside a hover card (shown as text).

## Column type inference

When column defs are not provided explicitly, the widget infers column types
from the data:

| Inferred type | Condition | Ag-grid treatment |
|---|---|---|
| `numeric` | Mostly numbers | `agNumberColumnFilter`, numeric cell class |
| `date` | ISO-8601 date strings | `agDateColumnFilter` |
| `boolean` | Mostly booleans | "Yes"/"No" cell renderer |
| `string` | Everything else | Text filter |

## What it gives the FINOS Workspace

- **Exports.** The export dialog offers *Rows (CSV)*.
- **Copilot context.** The AI agent receives row count, column count, column
  names, selection count, current filter/sort models, and per-column numeric
  statistics (min/max/sum/avg).
- **Grid events.** Selection changes, cell edits, filter/sort changes, and
  column resizes/moves are persisted to the `state` trait so they survive
  dashboard saves and are readable by the agent.

## Model traits

| Trait | Bind | Writable | Purpose |
|---|---|---|---|
| `data` | `data` | No | The grid data from the backend (extracted at `dataKey` path) |
| `definition` | `definition` | No | The widget's `data["ag-grid"]` object: the table chart configuration above. |
| `params` | `params` | Yes | The widget's params, written by `cellOnClick` with `groupBy` (needs `core:params:write`). |
| `capabilities` | `capabilities` | No | The permissions the organization left the widget. |
| `config` | `config` | No | Per-instance widget settings |
| `theme` | `theme` | No | `{ mode, tokens, ... }` — drives dark/light theme |
| `adminSettings` | `adminSettings` | No | Organization admin settings (license key, etc.) |
| `state` | `state` | Yes | Grid state written back: selection, last event, filter/sort models, column state, the ChartView and its chart, the last agent prompt |

## License key (AgGrid Enterprise)

AgGrid Community needs no license key. The package also bundles `ag-grid-charts-enterprise`
(AG Grid Enterprise with AG Charts Enterprise, which sparklines, integrated charts, the navigator
and chart types such as heatmap, treemap, waterfall and box plot need). It runs in trial mode,
with a watermark, until it has a key. The plugin reads the key from two
settings, in this order:

1. **Per-instance widget setting**: `licenseKey` in the widget's `settings`, for one card.
2. **Organization admin setting**: `licenseKey` under Admin, Widgets, AgGrid table, Settings,
   for every card of the organization.

The plugin passes the key to `LicenseManager.setLicenseKey()`.

## Build

```bash
npm install
npm run build   # writes dist/ag-grid/<version>/
```

The build bundles `ag-grid-community` into `entry.js`, inlines the ag-grid
theme CSS into `entry.css`, copies the icon, computes the SHA-256 checksum, and
writes `plugin.json` with `version` and `checksum`.

## Test

```bash
npm test
```

Tests run in Node. `test/widget.test.mjs` and `test/ag-table-chart.test.mjs` cover the helpers and every
table chart option: formatters, colour rules, the `customFormatter` evaluator (and that it runs no
code), sparkline options, hover cards, cell clicks, ChartView columns and the navigator.
`test/integration.test.mjs` renders real grids in jsdom: configured headers and formats, colours,
sparkline cells, the toolbar, a `groupBy` click writing the param, a falling cell flashing,
the integrated chart and transpose. Drawing charts needs a browser; check them on a dashboard.

## Deploy

1. Copy `dist/ag-grid/<version>/` into the plugins directory (`WIDGET_PLUGINS_DIR`), as
   `ag-grid/<version>/`.
2. Check it with the server's validator, from `backend-api/backend`:
   `python -m scripts.plugin_check <plugins dir>/ag-grid/<version> --digest`.
3. Where versions must be pinned, add the printed digest to
   `WIDGET_PLUGINS_PINS` as `"ag-grid@<version>": "<digest>"`.
4. Admin, Widgets, Deployment: Rescan, review, approve, and enable the plugin.
   Grant it to the roles that may use it.
5. Add a widget of type `ag-grid` to a dashboard, from a backend whose `widgets.json`
   declares one.

Every change is a new version: raise `version` in `package.json` and build
again. FINOS Workspace blocks an approved version whose files change.

## Try it

The [examples backend](../backend/README.md) declares `ag-grid` widgets for each data shape above
and one that streams. The *Sales by region* chart of the Plotly plugin shows its rows in this plugin.

### Table chart examples

[`examples/`](examples/) is a backend of its own for the table chart widgets, with no database
and nothing else to run: each example of OpenBB's AgGrid page, in the category *AgGrid table
chart examples*.

```bash
cd examples
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn server:app --port 7800
```

Add `http://localhost:7800` under Connections (it allows the web apps at `http://localhost:3000`
and `http://localhost:1420`) and put the widgets on a dashboard.

| Widget | Endpoint | Shows |
|---|---|---|
| `ag_table_chart_basic` | `/ag-table-chart/assets` | Columns, types and formats inferred from the rows |
| `ag_table_chart_column_definitions` | `/ag-table-chart/assets` | Header names and tooltips, data types, formats, widths, pinning, a hidden column |
| `ag_table_chart_render_functions` | `/ag-table-chart/assets` | `columnColor` rules, `greenRed`, `titleCase` |
| `ag_table_chart_hover_card` | `/ag-table-chart/projects` | A hover card with Markdown filled from the cell's object |
| `ag_table_chart_table_to_chart` | `/ag-table-chart/assets` | Opens as a column chart |
| `ag_table_chart_time_series` | `/ag-table-chart/time-series` | A line chart over dates with the navigator and its mini chart |
| `ag_table_chart_chart_ranges` | `/ag-table-chart/regions` | `cellRangeCols`: a stacked area of two regions |
| `ag_table_chart_sparklines` | `/ag-table-chart/sparklines` | Line and bar sparklines with their minimum and maximum |
| `ag_table_chart_sparkline_formatter` | `/ag-table-chart/profit-loss` | `customFormatter` |
| `ag_table_chart_cell_click` | `/ag-table-chart/companies` | `cellOnClick`: `groupBy`, `sendToAgent`, `openUrl` |
| `ag_table_chart_company_detail` | `/ag-table-chart/company?symbol=` | Transposed; follows the symbol a click in the companies widget sets |
| `ag_table_chart_live` | `/ag-table-chart/live` | Refreshes every five seconds; changed cells flash |

For *Company detail* to follow the clicks, put both widgets on one dashboard and add their
`symbol` parameters to one group.

To add a widget, add its definition to `WIDGETS` in `examples/ag_table_chart.py`, with its table
configuration in `data["ag-grid"]`, a function for its rows, and a route in `examples/server.py`.
`test_server.py` checks every widget's configuration against the plugin's `definition`:

```bash
.venv/bin/pip install pytest jsonschema httpx
.venv/bin/python -m pytest test_server.py
```
