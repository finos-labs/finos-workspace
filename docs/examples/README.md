# Widget plugin examples

Four widget plugins, each a package of its own, and the one backend that serves three of them. The plugins are built and deployed the way any plugin is
([docs/widget-plugins/AUTHORING.md](../widget-plugins/AUTHORING.md)). Nothing in
FINOS Workspace imports them; they show what the plugin framework does from an author's side.

| Folder | Plugin | Shows |
|---|---|---|
| [`plotly-charts/`](plotly-charts/README.md) | `plotly-charts` | A plugin that only draws: it renders the `plotly` widget type for any backend whose endpoint returns a Plotly figure as JSON, and offers its own exports and Copilot context. |
| [`ag-grid/`](ag-grid/README.md) | `ag-grid` | A plugin that only draws: it renders the `ag-grid` widget type with AgGrid, from records, columns, pandas formats or a full grid description, configured like OpenBB Workspace's table (column definitions, render functions, hover cards, sparklines, ChartView), with streaming rows, a side bar with Columns and Filters panels, and CSV export. |
| [`bq-ag-grid/`](bq-ag-grid/README.md) | `bq-ag-grid` | A second AgGrid plugin, a reusable component for any backend's rows: rows inferred, or a grid in AG Grid's own names (`rowData`, `columnDefs`, `gridOptions`) declared in the response or once in `widgets.json`, with AG Grid Community's sorting, filters and paging, its own grouping and pivot table, state saved with the dashboard, exports and Copilot context. Its two demo backends are in its `examples/`. |
| [`sql-explorer/`](sql-explorer/README.md) | `sql-explorer` | A plugin with a backend of its own: read-only SQL against a Postgres the deployment runs (over `tcp://` the admin approves) and DuckDB over data files, with routes, a secret, the identity check, pseudonymous callers, and completion from DuckDB-WASM in the frame (`core:asset:read`). |
| [`backend/`](backend/README.md) | | The one backend of all three: the widgets of the Plotly and AgGrid plugins, a SQL chart over files, and the SQL explorer's plugin backend, behind one gateway. |

Each plugin folder's README says how to build it (`npm run build` writes
`dist/<plugin id>/<version>/`, the directory a deployment places in its plugins
directory), how to test it, and how to try it on a local stack.
