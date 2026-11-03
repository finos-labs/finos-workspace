# Charts with the Plotly charts component

Use the Plotly charts component (`plotly-charts/chart`) to show a chart in the conversation: one to eight series of bars, lines, points or a pie. The user can add the card to a dashboard as a widget, so give it a clear name.

## Choose the trace

| The question | `type` | How |
|---|---|---|
| Compare a number across categories | `bar` | `x` holds the category labels and `y` the values. Several series side by side, or `layout.barmode: "stack"` to stack them. |
| A number over time, or over any ordered `x` | `scatter` with `mode: "lines"` (or `"lines+markers"`) | `x` holds dates as ISO strings (`"2026-01-01"`) or numbers. |
| Two numbers against each other | `scatter` with `mode: "markers"` | `x` and `y` are both numbers. |
| The shares of a whole | `pie` | `labels` and `values`, not `x` and `y`. |

For long category labels use `orientation: "h"`, with the numbers in `x` and the labels in `y`.

## The data

```json
{
  "data": [{ "type": "bar", "name": "Units", "x": ["Jan", "Feb", "Mar"], "y": [3, 8, 5] }],
  "layout": { "title": "Sales by month", "xaxis": { "title": "Month" }, "yaxis": { "title": "Units" } }
}
```

## Rules

- Name each series (`name`) when there are several: the names make the legend.
- Give titles to the chart and to the axes when the numbers need a unit.
- A series has at most 500 points, the chart at most eight series, and a pie at most 100 slices. When you have more rows, aggregate them first (by day, week or month) instead of sending every row.
- Do not set colours, templates or backgrounds. The chart is drawn in the workspace's light or dark mode, and again when the mode changes; setting a colour of the figure turns that off.
- The component takes only the fields above. Maps, heatmaps, 3D charts and animations need a backend that answers with a whole Plotly figure.
- Say what the chart shows and what stands out; do not repeat the numbers it draws.
