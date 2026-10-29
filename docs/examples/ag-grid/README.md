# AgGrid table for FINOS Workspace

A FINOS Workspace widget plugin that renders the `ag-grid` widget type with
[ag-grid Community](https://www.ag-grid.com/) (MIT-licensed, no licence key
required). It is an example in the repository's `docs/examples/`, a package of
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
| `definition` | `definition` | No | The widget's `data.ag-grid` object. The plugin declares no keys for it, so it is empty. |
| `config` | `config` | No | Per-instance widget settings |
| `theme` | `theme` | No | `{ mode, tokens, ... }` — drives dark/light theme |
| `adminSettings` | `adminSettings` | No | Organization admin settings (license key, etc.) |
| `state` | `state` | Yes | Grid state written back: selection, last event, filter/sort models, column state |

## License key (AgGrid Enterprise)

AgGrid Community needs no license key. The package also bundles `ag-grid-enterprise`, which
runs in trial mode, with a watermark, until it has a key. The plugin reads the key from two
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

Tests run in Node and cover `themeClass`, `rowIdOf`, `diffRows`,
`inferType`, `inferColumnType`, `normalizeData`, `numericStats`, and the
export/copilot shapes. Grid rendering needs a browser; check it on a dashboard.

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
