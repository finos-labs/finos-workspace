/*
 * Plotly charts for Workspace: an Anywidget front-end module (AFM 0.11) that renders a
 * backend widget of type `plotly`.
 *
 * The widget's endpoint returns a Plotly figure as JSON, `{"data": [...], "layout": {...},
 * "frames": [...]}`, the way plotly.py's `fig.to_json()` writes it, typed arrays included.
 * The figure is drawn as its author made it: template, colors and fonts are theirs.
 * Workspace sends the endpoint `theme=dark` or `theme=light`, the site's mode, and asks
 * again when it changes, so the author answers with the look they want for each.
 *
 * plotly.js is its strict bundle, which builds no functions from strings, loaded as a
 * classic script from a Blob URL (the frame's policy allows `blob:` scripts), because the
 * bundle expects a sloppy-mode script, not a module.
 */

const PLOTLY_SOURCE = "__PLOTLY_SOURCE__";

let plotlyLoading;

function loadPlotly() {
  plotlyLoading ??= new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([PLOTLY_SOURCE], { type: "text/javascript" }));
    const script = document.createElement("script");
    script.src = url;
    script.onload = () => {
      URL.revokeObjectURL(url);
      resolve(window.Plotly);
    };
    script.onerror = () => reject(new Error("plotly.js could not be loaded"));
    document.head.appendChild(script);
  });
  return plotlyLoading;
}

/** The figure in a response, or null when the response is not one. */
function figureOf(response) {
  if (!response || typeof response !== "object" || !Array.isArray(response.data)) return null;
  const layout = response.layout && typeof response.layout === "object" ? response.layout : {};
  const frames = Array.isArray(response.frames) ? response.frames : undefined;
  return { data: response.data, layout, frames };
}

// A typed array as plotly.py writes it: {"dtype": "f8", "bdata": "<base64>", "shape": "2, 3"}
const DTYPES = {
  int8: Int8Array,
  i1: Int8Array,
  uint8: Uint8Array,
  u1: Uint8Array,
  uint8c: Uint8ClampedArray,
  u1c: Uint8ClampedArray,
  int16: Int16Array,
  i2: Int16Array,
  uint16: Uint16Array,
  u2: Uint16Array,
  int32: Int32Array,
  i4: Int32Array,
  uint32: Uint32Array,
  u4: Uint32Array,
  float32: Float32Array,
  f4: Float32Array,
  float64: Float64Array,
  f8: Float64Array,
};

/** The values of a trace attribute: an array, a decoded typed array, or null. */
function valuesOf(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object" || typeof value.bdata !== "string") return null;
  const Type = DTYPES[value.dtype];
  if (!Type) return null;
  const bytes = Uint8Array.from(atob(value.bdata), (c) => c.charCodeAt(0));
  const flat = Array.from(new Type(bytes.buffer, 0, Math.floor(bytes.length / Type.BYTES_PER_ELEMENT)));
  const shape = String(value.shape ?? "")
    .split(",")
    .map((n) => Number.parseInt(n, 10))
    .filter((n) => n > 0);
  if (shape.length !== 2) return flat;
  const [rows, columns] = shape;
  return Array.from({ length: rows }, (_, row) => flat.slice(row * columns, (row + 1) * columns));
}

function titleOf(item) {
  const title = item?.title;
  return typeof title === "string" ? title : (title?.text ?? null);
}

/**
 * The figure's values as CSV, or null when no trace holds x/y or label/value pairs (a
 * trace with `z` holds a grid: its x and y are the grid's labels). Traces that share their
 * x values make one row per x with a column per trace; traces that do not make one row
 * per point, named by trace. Columns are named by the axis titles, or x and y.
 */
function csvOf(figure) {
  const series = figure.data
    .filter((trace) => trace.z === undefined)
    .map((trace, i) => {
      const ys = valuesOf(trace.y) ?? valuesOf(trace.values);
      const xs = valuesOf(trace.x) ?? valuesOf(trace.labels) ?? (ys && ys.map((_, j) => j));
      return { name: trace.name ?? `trace ${i + 1}`, xs, ys };
    })
    .filter((s) => s.xs && s.ys && !s.ys.some(Array.isArray));
  if (!series.length) return null;
  const quote = (value) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const x = titleOf(figure.layout.xaxis) || "x";
  const y = titleOf(figure.layout.yaxis) || "y";
  const [first] = series;
  const shared = series.every(
    (s) => s.xs.length === first.xs.length && s.xs.every((value, i) => value === first.xs[i]),
  );
  const rows = shared
    ? [[x, ...series.map((s) => s.name)], ...first.xs.map((value, i) => [value, ...series.map((s) => s.ys[i])])]
    : [["trace", x, y], ...series.flatMap((s) => s.xs.map((value, i) => [s.name, value, s.ys[i]]))];
  return rows.map((row) => row.map(quote).join(",")).join("\n");
}

/**
 * What the agent is told: the title and, per trace, its size and range, not its values.
 * A trace with `z` is a grid: its size is its cells, its range its z.
 */
function summary(figure) {
  return {
    title: titleOf(figure.layout),
    traces: figure.data.map((trace) => {
      const grid = trace.z !== undefined;
      const values = ((grid ? valuesOf(trace.z) : (valuesOf(trace.y) ?? valuesOf(trace.values))) ?? []).flat();
      const numbers = values.filter((v) => typeof v === "number" && Number.isFinite(v));
      const points = grid ? values : (valuesOf(trace.x) ?? valuesOf(trace.labels) ?? values);
      return {
        name: trace.name ?? null,
        type: trace.type ?? "scatter",
        points: points.length,
        min: numbers.length ? numbers.reduce((a, b) => Math.min(a, b)) : null,
        max: numbers.length ? numbers.reduce((a, b) => Math.max(a, b)) : null,
      };
    }),
  };
}

export default {
  initialize({ model }) {
    const current = () => figureOf(model.get("data"));
    // The chart, once Plotly has drawn it
    const drawn = () => document.querySelector(".plotly-chart.js-plotly-plot");
    return {
      async exportOptions() {
        const figure = current();
        if (!figure) return [];
        const options = [{ id: "figure", label: "Figure (Plotly JSON)", extension: "json", mime: "application/json" }];
        if (csvOf(figure)) options.unshift({ id: "csv", label: "Data (CSV)", extension: "csv", mime: "text/csv" });
        if (drawn()) options.push({ id: "svg", label: "Chart (SVG)", extension: "svg", mime: "image/svg+xml" });
        return options;
      },
      async exportData(id) {
        const figure = current();
        if (!figure) return null;
        if (id === "csv") return csvOf(figure);
        // The figure as the backend returned it
        if (id === "figure") return JSON.stringify(model.get("data"), null, 2);
        if (id === "svg") {
          const graph = drawn();
          if (!graph) return null;
          // As drawn, at the card's size
          const url = await window.Plotly.toImage(graph, {
            format: "svg",
            width: graph.clientWidth,
            height: graph.clientHeight,
          });
          return decodeURIComponent(url.slice(url.indexOf(",") + 1));
        }
        return null;
      },
      async copilotContext() {
        const figure = current();
        return figure ? summary(figure) : null;
      },
    };
  },

  async render({ model, el, signal }) {
    const Plotly = await loadPlotly();
    const graph = document.createElement("div");
    graph.className = "plotly-chart";
    const message = document.createElement("p");
    message.className = "plotly-message";
    el.replaceChildren(graph, message);

    // Plotly measures its text when it draws and keeps the measurements. A frame can start
    // with no size, where every label measures zero, so drawing waits for one.
    let pending = false;
    const draw = () => {
      pending = !el.clientWidth || !el.clientHeight;
      if (pending) return;
      const figure = figureOf(model.get("data"));
      if (!figure) {
        Plotly.purge(graph);
        message.textContent = "The endpoint did not return a Plotly figure.";
        return;
      }
      message.textContent = "";
      Plotly.react(graph, {
        data: figure.data,
        layout: figure.layout,
        frames: figure.frames,
        config: { responsive: true, displaylogo: false, modeBarButtonsToRemove: ["toImage"] },
      });
    };
    model.on("change:data", draw);
    draw();

    const resize = new ResizeObserver(() => (pending ? draw() : Plotly.Plots.resize(graph)));
    resize.observe(el);
    signal.addEventListener("abort", () => {
      resize.disconnect();
      Plotly.purge(graph);
    });
  },
};
