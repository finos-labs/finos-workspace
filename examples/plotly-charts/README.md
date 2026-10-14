# Plotly charts for Workspace

A Workspace widget plugin that draws the `plotly` widget type with plotly.js 4. Any
backend whose `widgets.json` declares a widget of type `plotly`, and whose endpoint returns
a Plotly figure as JSON, is drawn by this plugin once a Workspace deployment has approved
and enabled it. It is an example in the repository's `examples/`, a package of its own
that nothing in Workspace imports, built and deployed the way any plugin is
([AUTHORING.md](../../docs/widget-plugins/AUTHORING.md)).

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
author's. Workspace adds `theme=dark` or `theme=light` to the endpoint's query, the
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

A response that is not a figure shows "The endpoint did not return a Plotly figure."

## What it gives the Workspace

- **Exports.** The export dialog lists what the figure holds:
  - *Data (CSV)*, when a trace has x/y or label/value pairs (a trace with `z` is a grid,
    and has none). Traces that share their x values give one row per x and a column per
    trace; traces that do not give one row per point: trace, x, y. Columns are named by
    the axis titles.
  - *Figure (Plotly JSON)*, the figure as the endpoint returned it.
  - *Chart (SVG)*, once the chart is drawn: as drawn, at the card's size.
- **Agent context.** The title and, per trace, its name, type, number of points, and
  minimum and maximum (of z for a grid). The values themselves stay out.

It asks for `core:data:read`, `core:export:provide` and `core:copilot:context`. It
declares no network access, proxies or backend: everything it draws comes from the
widget's own endpoint through Workspace.

## Build

Node 20 or later. The only dependency is `plotly.js-strict-dist-min`, plotly.js's
strict bundle: every trace type, built without function constructors, which a plugin
frame's policy refuses.

```bash
npm install
```

```bash
npm run build
```

The build writes `dist/plotly-charts/<version>/`, with the version from `package.json`:

- `entry.js`: `src/entry.js` with the bundle inlined. A plugin frame loads one module and
  its styles, nothing else. plotly.js is loaded as a classic script from a Blob URL,
  because its bundle expects a sloppy-mode script.
- `entry.css`, `assets/icon.svg`.
- `plugin.json`: `src/plugin.json` with the version and the checksum.

It prints the checksum and the version digest. `PLOTLY_BUNDLE=<path>` builds from another
copy of `plotly-strict.min.js`.

```bash
npm test
```

The tests run the exports and the agent context in Node, typed arrays included. Drawing
needs a browser; check it on a dashboard, below.

## Deploy

On a Workspace deployment (`local/LOCAL_SETUP.md`, "Widget plugins", for your own stack):

1. Copy `dist/plotly-charts/<version>/` into the plugins directory
   (`WIDGET_PLUGINS_DIR`), as `plotly-charts/<version>/`.
2. Check it with the server's validator, from `backend-api/backend`:
   `python -m scripts.plugin_check <plugins directory>/plotly-charts/<version> --digest`.
3. Where versions must be pinned, add the printed digest to `WIDGET_PLUGINS_PINS` as
   `"plotly-charts@<version>": "<digest>"`.
4. Admin, Widgets, Deployment: Rescan, review what the version asks for, approve it,
   and enable it for the organization. Then choose who may use it.

Every change is a new version: raise `version` in `package.json` and build again.
Workspace blocks an approved version whose files change.

## Try it

`examples/backend.py` is a backend with four `plotly` widgets made with plotly.py:
stacked bars, lines, a sampled signal from numpy arrays, and a heatmap. It answers
`theme=dark` with plotly.py's `plotly_dark` template and `theme=light` with
`plotly_white`.

```bash
python3 -m venv examples/.venv
```

```bash
examples/.venv/bin/pip install -r examples/requirements.txt
```

```bash
npm run demo-backend
```

It listens on `http://localhost:7798` and allows the Workspace web app at
`http://localhost:3000`; `examples/.venv/bin/python examples/backend.py <port> <web app
origin>` changes either. Connect it as a backend under Connections, then add *Sales by
region*, *Sales trend*, *Signal and noise* and *Correlation* to a dashboard.

## Notes

- A dashboard places its cards after their frames start, so the widget can render before
  it has a size. Plotly measures text when it draws and keeps the measurements, so the
  widget draws once it has a size and redraws when it gets one.
- Map traces (`scattermap`, `choroplethmap`, `densitymap`) need map tiles from the
  network. The plugin declares no network access, so its frame cannot fetch them.
- `entry.js` is about 5 MB. The browser caches it per version.
