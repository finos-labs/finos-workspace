# Examples

[`reference-backend/`](reference-backend/README.md) is a data backend in Python and TypeScript with a widget of
every built-in type, every kind of parameter, the widget settings, linked widgets, a form and an app.

[`reference-agent/`](reference-agent/README.md) is an agent in Python and TypeScript that answers questions about the widgets of a dashboard without a model. It reads the dashboard, asks the browser for the data of a widget, cites it and reads settings.

The other three are widget plugins, each a package of its own, and the one backend that serves them. The plugins are built and deployed the way any plugin is
([How to build and try a widget plugin](../tutorials/plugins/build-a-plugin.md)). Nothing in
FINOS Workspace imports them; they show what the plugin framework does from an author's side.

| Folder | Plugin | Shows |
|---|---|---|
| [`plotly-charts/`](plotly-charts/README.md) | `plotly-charts` | A plugin that only draws: it renders the `plotly` widget type for any backend whose endpoint returns a Plotly figure as JSON, and offers its own exports and Agent context. |
| [`ag-grid/`](ag-grid/README.md) | `ag-grid` | A plugin that only draws: it renders the `ag-grid` widget type with AgGrid, from records, columns, pandas formats or a full grid description, configured like OpenBB Workspace's table (column definitions, render functions, hover cards, sparklines, ChartView), with streaming rows, a side bar with Columns and Filters panels, and CSV export. |
| [`sql-explorer/`](sql-explorer/README.md) | `sql-explorer` | A plugin with a backend of its own: read-only SQL against a Postgres the deployment runs (over `tcp://` the admin approves) and DuckDB over data files, with routes, a secret, the identity check, pseudonymous callers, and completion from DuckDB-WASM in the frame (`core:asset:read`). |
| [`backend/`](backend/README.md) | | The one backend of all three: the widgets of the Plotly and AgGrid plugins, a live socket, a SQL chart over files, and the plugin backends of the SQL explorer and of AgGrid, behind one gateway. |

Each plugin also gives the AI agent two things, which the review of its version lists: a component the agent can show in the chat with data it has (`artifact` on a widget), which the user can then add to a dashboard as a widget, and a skill, a markdown file under `src/skills/` that tells the agent when and how to use it. The Plotly plugin offers a chart and the SQL explorer a query in a table; a query runs from the user's session when the card opens, and the skills give the agent the exact steps and the tables of the example deployment. The manifest keys that hold them are in [the package and the manifest](../reference/plugins/package-and-manifest.mdx).

Each plugin folder's README says how to build it (`npm run build` writes
`dist/<plugin id>/<version>/`, the directory a deployment places in its plugins
directory), how to test it, and how to try it on a local stack.
