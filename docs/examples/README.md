# Examples

[`reference-backend/`](reference-backend/README.md) is a data backend in Python and TypeScript with a widget of
every built-in type, every kind of parameter, the widget settings, linked widgets, a form and an app.

The other two are widget plugins, each a package of its own, built and deployed the way any plugin is
([How to build and try a widget plugin](../tutorials/plugins/build-a-plugin.md)). Nothing in
FINOS Workspace imports them; they show what the plugin framework does from an author's side.

| Folder | Plugin | Shows |
|---|---|---|
| [`plotly-charts/`](plotly-charts/README.md) | `plotly-charts` | A plugin that only draws: it renders the `plotly` widget type for any backend whose endpoint returns a Plotly figure as JSON, and offers its own exports and Agent context. |
| [`sql-explorer/`](sql-explorer/README.md) | `sql-explorer` | A plugin with a backend of its own: read-only SQL against a Postgres the deployment runs (over `tcp://` the admin approves) and DuckDB over mounted files, with routes, a secret, the identity check, pseudonymous callers, and completion from DuckDB-WASM in the frame (`core:asset:read`). |

Each folder's README says how to build it (`npm run build` writes
`dist/<plugin id>/<version>/`, the directory a deployment places in its plugins
directory), how to test it, and how to try it on a local stack.
