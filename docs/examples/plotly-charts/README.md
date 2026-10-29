# Plotly charts for FINOS Workspace

A FINOS Workspace widget plugin that draws the `plotly` widget type with plotly.js 4. Any
backend whose `widgets.json` declares a widget of type `plotly`, and whose endpoint returns
a Plotly figure as JSON, is drawn by this plugin once a FINOS Workspace deployment has approved
and enabled it. It is an example in the repository's `docs/examples/`, a package of its own
that nothing in FINOS Workspace imports, built and deployed the way any plugin is
([AUTHORING.md](../../widget-plugins/AUTHORING.md)).

## The contract

The widget's endpoint returns a Plotly figure:
`{"data": [traces], "layout": {...}, "frames": [...]}`, as plotly.py's `fig.to_json()`
writes it, numpy arrays as typed arrays included. A backend declares the widget with its
type and endpoint; there is nothing else to configure:

```json
{
  "sales": {
    "name": "Sales by region",
    "type": "plotly",
    "endpoint": "/sales"
  }
}
```

The figure is drawn as its author made it: template, colors, fonts and size are the
author's. FINOS Workspace adds `theme=dark` or `theme=light` to the endpoint's query, the
site's mode, and asks again when the user switches it. The endpoint answers with the
look it wants for each:

```python
import plotly.graph_objects as go
from fastapi import FastAPI, Response

app = FastAPI()
TEMPLATES = {"dark": "plotly_dark", "light": "plotly_white"}

@app.get("/sales")
def sales(theme: str = "dark"):
    figure = go.Figure(go.Bar(x=["Jan", "Feb"], y=[100, 114]))
    figure.update_layout(template=TEMPLATES.get(theme, "plotly"))
    return Response(figure.to_json(), media_type="application/json")
```

A response that is not a figure shows "The endpoint did not return a Plotly figure.", and a
figure plotly.js cannot draw shows why on the card.

### The rows: `raw`

A widget can give the rows its chart is made from ([WIDGETS-JSON.md 4.11](../../widget-plugins/WIDGETS-JSON.md)).
With `"raw": true`, FINOS Workspace asks the endpoint again with the widget's params and
`raw=true`, and reads the rows at `data.rawDataKey`, else the answer's `results`, else the
whole answer. The AI agent and MCP clients get those rows instead of the figure, and the
card's database button shows them: drawn by this plugin as a table, or by the plugin of
`data.rawType` when the user may use that type.

```json
{
  "sales": {
    "name": "Sales by region",
    "type": "plotly",
    "endpoint": "/sales",
    "raw": true
  }
}
```

```python
ROWS = [{"month": "Jan", "sales": 100}, {"month": "Feb", "sales": 114}]

@app.get("/sales")
def sales(theme: str = "dark", raw: bool = False):
    if raw:
        return ROWS
    figure = go.Figure(go.Bar(x=[r["month"] for r in ROWS], y=[r["sales"] for r in ROWS]))
    figure.update_layout(template=TEMPLATES.get(theme, "plotly"))
    return Response(figure.to_json(), media_type="application/json")
```

An endpoint that answers both in one shape, `{"results": {"chart": <figure>, "records":
[...]}}`, sets `"data": {"dataKey": "results.chart", "rawDataKey": "results.records"}`.

## What it gives the FINOS Workspace

- **Exports.** The export dialog lists what the figure holds:
  - *Data (CSV)*, when a trace has x/y, label/value or open/high/low/close values (a
    trace with `z` is a grid, and has none). Traces that share their x values give one
    row per x and a column per trace (per trace and field for open/high/low/close);
    traces that do not give one row per point: trace, x, y. Columns are named by the axis
    titles.
  - *Figure (Plotly JSON)*, the figure as the endpoint returned it.
  - *Chart (SVG)*, once the chart is drawn: as drawn, at the card's size.
  - With the rows shown: *Rows (CSV)*, *Rows (JSON)* and *Table (SVG)*.
- **Agent context.** With `raw`, the AI agent gets the rows. Without it, the figure, and
  the title and, per trace, its name, type, number of points, and minimum and maximum
  (of z for a grid, of low and high for open/high/low/close).
- **Maps.** Geo traces (`scattergeo`, `choropleth`) are drawn with the outlines of
  [sane-topojson](https://github.com/plotly/sane-topojson), which plotly.js would fetch
  and which come with the package instead: the world, the USA, Europe, Asia, Africa,
  North and South America, at 1:110m and 1:50m. A figure's outlines are read the first
  time it needs them. Tile maps (`scattermap`, `densitymap`, `choroplethmap`) are drawn
  with the figure's own base map when the frame can reach it: the hosts its style names
  (by default `basemaps.cartocdn.com`), which a superuser allows in the plugin's CSP
  override ([SECURITY.md](../../widget-plugins/SECURITY.md)); the plugin's Blocked
  requests list names them. Otherwise they are drawn over a base map made from the same
  outlines, at 1:50m: water, land, lakes, country borders and coastlines, in the site's
  light or dark mode. Labels on it are drawn with the browser's own fonts, so nothing is
  fetched; `"white-bg"` is drawn the same way.
- **LaTeX.** Text plotly.js reads as LaTeX, `$...$`, is typeset with MathJax 4, read
  from the package the first time a figure has some.

It asks for `core:data:read`, `core:export:provide` and `core:copilot:context`. It
declares no network access, proxies or backend: everything it draws comes from the
widget's own endpoint through FINOS Workspace, and the outlines and MathJax from its package.

## Build

Node 20 or later. The dependencies are `plotly.js-strict-dist-min`, plotly.js's strict
bundle: every trace type, built without function constructors, which a plugin frame's
policy refuses; `sane-topojson`, the map outlines; and `mathjax`, for LaTeX.

```bash
npm install
```

```bash
npm run build
```

The build writes `dist/plotly-charts/<version>/`, with the version from `package.json`:

- `entry.js`: `src/entry.js` with the bundle inlined. A plugin frame loads one module and
  its styles, nothing else. plotly.js is loaded as a classic script from a Blob URL,
  because its bundle expects a sloppy-mode script. The bundle's MapLibre worker, which
  draws tile maps, ends with an `export` that makes it a module; Chromium does not start
  a module worker from a Blob URL in the frame's opaque origin, so the build takes that
  one `export` out and the worker starts as a classic script. The build stops if the
  bundle does not have it exactly once.
- `entry.css`, `assets/icon.svg`.
- `assets/topojson-<scope>_<resolution>m.json`, the outlines, and
  `assets/mathjax-tex-svg.js`, MathJax with its font: files the module reads from the
  host (`core:asset:read`) when a figure needs them.
- `assets/THIRD-PARTY-LICENSES.txt`: the license of plotly.js, MathJax and
  sane-topojson, which the package redistributes.
- `plugin.json`: `src/plugin.json` with the version and the checksum.

It prints the checksum and the version digest. `PLOTLY_BUNDLE=<path>` builds from another
copy of `plotly-strict.min.js`.

```bash
npm test
```

The tests run the exports, the agent context, the rows, and which outlines and whether
MathJax a figure needs, in Node, typed arrays included. Drawing needs a browser; check it
on a dashboard, below.

## Deploy

On a FINOS Workspace deployment (`local/LOCAL_SETUP.md`, "Widget plugins", for your own stack):

1. Copy `dist/plotly-charts/<version>/` into the plugins directory
   (`WIDGET_PLUGINS_DIR`), as `plotly-charts/<version>/`.
2. Check it with the server's validator, from `backend-api/backend`:
   `python -m scripts.plugin_check <plugins directory>/plotly-charts/<version> --digest`.
3. Where versions must be pinned, add the printed digest to `WIDGET_PLUGINS_PINS` as
   `"plotly-charts@<version>": "<digest>"`.
4. Admin, Widgets, Deployment: Rescan, review what the version asks for, approve it,
   and enable it for the organization. Then, under Roles, grant it to the roles that may
   use it: a role is the only way to a plugin.

Every change is a new version: raise `version` in `package.json` and build again.
FINOS Workspace blocks an approved version whose files change. On your own stack, the
plugin's Deployment page starts the next version for you and serves it from its files
as you rebuild them (`docs/widget-plugins/AUTHORING.md`, section 11).

## Try it

The [examples backend](../backend/README.md) has five `plotly` widgets made with plotly.py: stacked bars, lines, a sampled signal from numpy arrays, a heatmap, and the bars of any SQL query. It answers `theme=dark` with plotly.py's `plotly_dark` template and `theme=light` with `plotly_white`. Connect it as a backend under Connections, then add *Sales by region*, *Sales trend*, *Signal and noise*, *Correlation* and *SQL chart* to a dashboard. *Sales by region* has `raw`: its database button shows its rows, drawn by the AgGrid plugin, and the AI agent reads them.

## Notes

- A dashboard places its cards after their frames start, so the widget can render before
  it has a size. Plotly measures text when it draws and keeps the measurements, so the
  widget draws once it has a size and redraws when it gets one.
- `entry.js` is about 5 MB. The browser caches it per version. The outlines (3.7 MB) and
  MathJax (1.8 MB) are read only by a figure that needs them.
