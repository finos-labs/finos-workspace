# Widget plugin examples

Three widget plugins, each a package of its own, built and deployed the way any plugin is
([docs/widget-plugins/AUTHORING.md](../widget-plugins/AUTHORING.md)). Nothing in
Workspace imports them; they show what the plugin framework does from an author's side.

| Folder | Plugin | Shows |
|---|---|---|
| [`plotly-charts/`](plotly-charts/README.md) | `plotly-charts` | A plugin that only draws: it renders the `plotly` widget type for any backend whose endpoint returns a Plotly figure as JSON, and offers its own exports and Copilot context. |
| [`bq-advanced-grouping/`](bq-advanced-grouping/README.md) | `bq-advanced-grouping` | A plugin written in TypeScript and React with a library bundled in (AG Grid Community): it renders the `bq-advanced-grouping` widget type, company rows grouped and aggregated across any combination of columns, with the search, the exports and the Copilot context in the frame. |
| [`sql-explorer/`](sql-explorer/README.md) | `sql-explorer` | A plugin with a backend of its own: read-only SQL against a Postgres the deployment runs (over `tcp://` the admin approves) and DuckDB over mounted files, with routes, a secret, the identity check, pseudonymous callers, and completion from DuckDB-WASM in the frame (`core:asset:read`). |

Each folder's README says how to build it (`npm run build` writes
`dist/<plugin id>/<version>/`, the directory a deployment places in its plugins
directory), how to test it, and how to try it on a local stack.
