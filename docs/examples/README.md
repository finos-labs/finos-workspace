# Widget plugin examples

Three widget plugins, each a package of its own, and the one backend that serves them. The plugins are built and deployed the way any plugin is
([docs/widget-plugins/AUTHORING.md](../widget-plugins/AUTHORING.md)). Nothing in
FINOS Workspace imports them; they show what the plugin framework does from an author's side.

| Folder | Plugin | Shows |
|---|---|---|
| [`plotly-charts/`](plotly-charts/README.md) | `plotly-charts` | A plugin that only draws: it renders the `plotly` widget type for any backend whose endpoint returns a Plotly figure as JSON, and offers its own exports and Copilot context. |
| [`ag-grid/`](ag-grid/README.md) | `ag-grid` | A plugin that only draws: it renders the `ag-grid` widget type with AgGrid, from records, columns, pandas formats or a full grid description, with streaming rows, a side bar with Columns and Filters panels, and CSV export. |
| [`sql-explorer/`](sql-explorer/README.md) | `sql-explorer` | A plugin with a backend of its own: read-only SQL against a Postgres the deployment runs (over `tcp://` the admin approves) and DuckDB over data files, with routes, a secret, the identity check, pseudonymous callers, and completion from DuckDB-WASM in the frame (`core:asset:read`). |
| [`backend/`](backend/README.md) | | The one backend of all three: the widgets of the Plotly and AgGrid plugins, a SQL chart over files, and the SQL explorer's plugin backend, behind one gateway. |

Each plugin also gives the AI agent two things, which the review of its version lists: a component the agent can show in the chat with data it has (`artifact` on a widget, AUTHORING.md 3.3), which the user can then add to a dashboard as a widget, and a skill, a markdown file under `src/skills/` that tells the agent when and how to use it (3.2). The Plotly plugin offers a chart, the AgGrid plugin a table of rows, and the SQL explorer a query result in its SQL grid; the SQL explorer's skill also covers writing SQL for its two sources.

Each plugin folder's README says how to build it (`npm run build` writes
`dist/<plugin id>/<version>/`, the directory a deployment places in its plugins
directory), how to test it, and how to try it on a local stack.
