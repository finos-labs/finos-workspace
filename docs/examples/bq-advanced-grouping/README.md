# BQ Advanced Grouping for Workspace

A Workspace widget plugin that shows the `bq-advanced-grouping` widget type: company rows
grouped and aggregated across any combination of columns, in AG Grid Community. It is the
BQ Advanced Grouping plugin of `bq-workspace-plugins`, ported from a page on a plugin host
to a plugin package ([AUTHORING.md](../../widget-plugins/AUTHORING.md)), on the same
lines as [`plotly-charts`](../plotly-charts/README.md). Nothing in Workspace imports it.

## The contract

The widget's endpoint returns company rows, as the companies backend's
`GET /bq/advanced-grouping` does:

```json
{
  "rows": [
    {
      "id": "1",
      "company": "Echo Delta Holdings 1",
      "sector": "Energy",
      "industry": "Oil & Gas",
      "state": "WA",
      "size": "Small",
      "revenueUsdM": 7.0,
      "employees": 199,
      "foundedYear": 2019
    }
  ],
  "total": 500
}
```

The rows as an array work too. A backend declares the widget with its type and endpoint:

```json
{
  "bq_advanced_grouping": {
    "name": "BQ Advanced Grouping",
    "type": "bq-advanced-grouping",
    "endpoint": "/bq/advanced-grouping"
  }
}
```

## What changed from the plugin-host version

| Before (a page on the plugin host) | Now (a plugin package) |
|---|---|
| The page fetched `apiUrl` itself, from a widget setting | Workspace fetches the widget's endpoint with the user's credentials and pushes the response into the `data` trait. The frame has no network, and there is no `apiUrl`. |
| The search was a `search=` query to the backend | The search runs in the frame, over the rows it has, on the same text columns. |
| An in-grid CSV button | Workspace's Export menu: the groups (CSV, when grouped), the companies the search keeps (CSV) and the response (JSON), through `core:export:provide`. |
| Nothing for the agent | `copilotContext()` gives the grouping, the aggregation, the search, the totals and the top-level groups with their counts and aggregates, not the rows. |
| Config from `VITE_PLUGIN_ADVANCED_GROUPING_*` at build time | Fixed defaults in `src/types.ts` (group by sector, then state; sum). |

The grouping (`src/grouping.ts`, with its tests), the toolbar, the group cells and the
styles are the original plugin's.

## Build

Node 20 or later.

```bash
npm install
npm run build
```

The build bundles `src/entry.tsx` with esbuild, React and AG Grid Community included, into
`dist/bq-advanced-grouping/<version>/entry.js` (about 1.2 MB), and prints the checksum and
the version digest. `.npmrc` sets `legacy-peer-deps`, which works around an npm 10 error
resolving the test tools' optional peers.

`plugin_check` warns that the entry uses `new Function`. That is AG Grid's expression
service, which runs only for column definitions written as strings; this plugin's are
functions, so the frame's block on `eval` costs nothing.

## Test

```bash
npm run typecheck
npm test
```

The tests check the grouping, the parsing of the response, the search, the exports and
the agent context. Drawing needs a browser and is checked on a dashboard.

## Try it

1. Build into the plugins directory of your local stack (`local/LOCAL_SETUP.md`, section
   Widget plugins): copy `dist/bq-advanced-grouping/<version>/` to
   `<plugins directory>/bq-advanced-grouping/<version>/`.
2. In Workspace, Admin, Widgets, Deployment: Rescan, review and approve the version, and
   enable it for your organization. Under Plugin widgets, enable it, and under Roles and
   Access grant it to a role you hold.
3. Connect the companies backend (`openbq/mock-backend`, `http://localhost:7779`) under
   Connections. Its `widgets.json` declares `bq_advanced_grouping` with this type.
4. Add *BQ Advanced Grouping* to a dashboard.

To change it on a local stack, start the next version on the plugin's Deployment page
(Patch, Minor or Major) and build into that version's directory: the app serves its files
as they are until you approve it. Anywhere else, every change is a new version: raise
`version` in `package.json` and build again.
