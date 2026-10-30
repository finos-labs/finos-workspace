const PLOTLY_SOURCE = "__PLOTLY_SOURCE__";
const MATHJAX_ASSET = "assets/mathjax-tex-svg.js";
const topojsonAsset = (name) => `assets/topojson-${name}.json`;

function runScript(source, what) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    const script = document.createElement("script");
    script.src = url;
    script.onload = () => {
      URL.revokeObjectURL(url);
      resolve();
    };
    script.onerror = () => reject(new Error(`${what} could not be loaded`));
    document.head.appendChild(script);
  });
}

function startBlobWorkersClassic() {
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(url, options) {
      const blobModule = options?.type === "module" && String(url).startsWith("blob:");
      super(url, blobModule ? { ...options, type: "classic" } : options);
    }
  };
}

let plotlyLoading;

function loadPlotly() {
  plotlyLoading ??= (async () => {
    startBlobWorkersClassic();
    await runScript(PLOTLY_SOURCE, "plotly.js");
    return window.Plotly;
  })();
  return plotlyLoading;
}

function figureOf(response) {
  if (!response || typeof response !== "object" || !Array.isArray(response.data)) return null;
  const layout = response.layout && typeof response.layout === "object" ? response.layout : {};
  const frames = Array.isArray(response.frames) ? response.frames : undefined;
  return { data: response.data, layout, frames };
}

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

const GEO_TRACES = new Set(["scattergeo", "choropleth"]);

export function topojsonNames(figure) {
  const subplots = new Set(figure.data.filter((trace) => GEO_TRACES.has(trace.type)).map((trace) => trace.geo ?? "geo"));
  return [...subplots].map((id) => {
    const geo = figure.layout[id] ?? {};
    const scope = typeof geo.scope === "string" ? geo.scope : "world";
    return `${scope.replaceAll(" ", "-")}_${Number(geo.resolution) === 50 ? 50 : 110}m`;
  });
}

export function hasLatex(value, depth = 0) {
  if (typeof value === "string") return /\$[^$]*\$/.test(value);
  if (!value || typeof value !== "object" || depth > 10) return false;
  if (Array.isArray(value)) return value.length <= 1000 && value.some((item) => hasLatex(item, depth + 1));
  if (typeof value.bdata === "string") return false;
  return Object.values(value).some((item) => hasLatex(item, depth + 1));
}

const MAP_TRACES = new Set(["scattermap", "densitymap", "choroplethmap"]);

export function mapSubplots(figure) {
  return [...new Set(figure.data.filter((trace) => MAP_TRACES.has(trace.type)).map((trace) => trace.subplot ?? "map"))];
}

export function featuresOf(topology, name) {
  const transform = topology.transform;
  const arcs = topology.arcs.map((arc) => {
    if (!transform) return arc;
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x * transform.scale[0] + transform.translate[0], y * transform.scale[1] + transform.translate[1]];
    });
  });
  const line = (indexes) =>
    indexes.flatMap((index, k) => {
      const arc = index < 0 ? [...arcs[~index]].reverse() : arcs[index];
      return k ? arc.slice(1) : arc;
    });
  const lines = (list) => list.filter((indexes) => indexes.length).map(line);
  const geometry = (shape) => {
    const coordinates =
      shape.type === "LineString"
        ? line(shape.arcs)
        : shape.type === "MultiLineString" || shape.type === "Polygon"
          ? lines(shape.arcs)
          : shape.type === "MultiPolygon"
            ? shape.arcs.map(lines).filter((polygon) => polygon.length)
            : [];
    return coordinates.length ? { type: shape.type, coordinates } : null;
  };
  const object = topology.objects[name];
  const shapes = object.type === "GeometryCollection" ? object.geometries : [object];
  return {
    type: "FeatureCollection",
    features: shapes
      .map((shape) => ({ type: "Feature", properties: {}, geometry: shape.arcs ? geometry(shape) : null }))
      .filter((feature) => feature.geometry),
  };
}

const BASE_COLORS = {
  light: { water: "#d5dde3", land: "#f3f1ec", border: "#b5b5b5", coast: "#9cadb8" },
  dark: { water: "#18212b", land: "#2a323c", border: "#505b67", coast: "#3c4a57" },
};

export function baseStyle(world, mode) {
  const colors = BASE_COLORS[mode === "light" ? "light" : "dark"];
  const source = (name) => ({ type: "geojson", data: featuresOf(world, name) });
  return {
    version: 8,
    sources: { land: source("land"), lakes: source("lakes"), countries: source("countries"), coastlines: source("coastlines") },
    layers: [
      { id: "water", type: "background", paint: { "background-color": colors.water } },
      { id: "land", type: "fill", source: "land", paint: { "fill-color": colors.land } },
      { id: "lakes", type: "fill", source: "lakes", paint: { "fill-color": colors.water } },
      { id: "borders", type: "line", source: "countries", paint: { "line-color": colors.border, "line-width": 0.6 } },
      { id: "coastlines", type: "line", source: "coastlines", paint: { "line-color": colors.coast, "line-width": 0.6 } },
    ],
  };
}

const WHITE_BG = { version: 8, sources: {}, layers: [{ id: "white-bg", type: "background", paint: { "background-color": "#FFFFFF" } }] };

export function withMapStyle(figure, subplots, style) {
  const layout = { ...figure.layout };
  for (const id of subplots) {
    const map = layout[id] ?? {};
    if (style) layout[id] = { ...map, style };
    else if (map.style === "white-bg") layout[id] = { ...map, style: WHITE_BG };
  }
  return { ...figure, layout };
}

async function readAsset(invoke, path) {
  const [, [bytes]] = await invoke("core:asset:read", { path }, { timeout: 60_000 });
  return bytes;
}

const baseStyles = {};

async function loadBaseStyle(invoke, mode) {
  await loadOutlines(invoke, ["world_50m"]);
  baseStyles[mode] ??= baseStyle(window.PlotlyGeoAssets.topojson.world_50m, mode);
  return baseStyles[mode];
}

async function loadOutlines(invoke, names) {
  window.PlotlyGeoAssets ??= { topojson: {} };
  const outlines = window.PlotlyGeoAssets.topojson;
  await Promise.all(
    names
      .filter((name) => !outlines[name])
      .map(async (name) => {
        outlines[name] = JSON.parse(new TextDecoder().decode(await readAsset(invoke, topojsonAsset(name))));
      }),
  );
}

let mathJaxLoading;

function loadMathJax(invoke) {
  mathJaxLoading ??= (async () => {
    window.MathJax = {
      startup: { typeset: false },
      options: { enableMenu: false, menuOptions: { settings: { enrich: false, speech: false, braille: false } } },
    };
    await runScript(await readAsset(invoke, MATHJAX_ASSET), "MathJax");
    await window.MathJax.startup.promise;
  })().catch((error) => {
    mathJaxLoading = undefined;
    throw error;
  });
  return mathJaxLoading;
}

function rowsOf(response) {
  return Array.isArray(response) &&
    response.length > 0 &&
    response.every((row) => row && typeof row === "object" && !Array.isArray(row))
    ? response
    : null;
}

const columnsOf = (rows) => [...new Set(rows.flatMap((row) => Object.keys(row)))];
const cellOf = (value) => (value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : value);

const TABLE_COLORS = {
  light: { paper: "white", font: "#2a3f5f", header: "#C8D4E3", cells: "#EBF0F8", line: "white" },
  dark: { paper: "rgb(17,17,17)", font: "#f2f5fa", header: "#2a3f5f", cells: "#506784", line: "rgb(17,17,17)" },
};

function tableOf(rows, mode) {
  const columns = columnsOf(rows);
  const colors = TABLE_COLORS[mode === "light" ? "light" : "dark"];
  return {
    data: [
      {
        type: "table",
        header: { values: columns, fill: { color: colors.header }, line: { color: colors.line }, align: "left" },
        cells: {
          values: columns.map((column) => rows.map((row) => cellOf(row[column]))),
          fill: { color: colors.cells },
          line: { color: colors.line },
          align: "left",
        },
      },
    ],
    layout: { paper_bgcolor: colors.paper, font: { color: colors.font }, margin: { l: 8, r: 8, t: 8, b: 8 } },
  };
}

const FIGURE_COLORS = {
  light: { paper: "white", plot: "#E5ECF6", font: "#2a3f5f", grid: "white" },
  dark: { paper: "rgb(17,17,17)", plot: "rgb(17,17,17)", font: "#f2f5fa", grid: "#506784" },
};

export function followsTheme(figure) {
  const { layout } = figure;
  return !(layout.template || layout.paper_bgcolor || layout.plot_bgcolor);
}

export function themedFigure(figure, mode) {
  if (!followsTheme(figure)) return figure;
  const colors = FIGURE_COLORS[mode === "light" ? "light" : "dark"];
  const axis = (own) => ({ gridcolor: colors.grid, zerolinecolor: colors.grid, linecolor: colors.grid, ...(own && typeof own === "object" ? own : {}) });
  return {
    ...figure,
    layout: {
      ...figure.layout,
      paper_bgcolor: colors.paper,
      plot_bgcolor: colors.plot,
      font: { color: colors.font, ...(figure.layout.font ?? {}) },
      xaxis: axis(figure.layout.xaxis),
      yaxis: axis(figure.layout.yaxis),
    },
  };
}

function csvLine(row) {
  return row
    .map((value) => {
      const text = value === null || value === undefined ? "" : String(value);
      return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    })
    .join(",");
}

const POINT_FIELDS = { candlestick: ["open", "high", "low", "close"], ohlc: ["open", "high", "low", "close"] };

function csvOf(figure) {
  const series = figure.data
    .filter((trace) => trace.z === undefined)
    .map((trace, i) => {
      const fields = POINT_FIELDS[trace.type];
      const columns = fields
        ? fields.map((field) => ({ field, values: valuesOf(trace[field]) }))
        : [{ field: null, values: valuesOf(trace.y) ?? valuesOf(trace.values) }];
      const first = columns[0].values;
      const xs = valuesOf(trace.x) ?? valuesOf(trace.labels) ?? (first && first.map((_, j) => j));
      return { name: trace.name ?? `trace ${i + 1}`, xs, columns };
    })
    .filter((s) => s.xs && s.columns.every((c) => c.values && !c.values.some(Array.isArray)));
  if (!series.length) return null;
  const x = titleOf(figure.layout.xaxis) || "x";
  const y = titleOf(figure.layout.yaxis) || "y";
  const [first] = series;
  const shared = series.every(
    (s) => s.xs.length === first.xs.length && s.xs.every((value, i) => value === first.xs[i]),
  );
  const label = (s, c) => (c.field === null ? s.name : series.length > 1 ? `${s.name} ${c.field}` : c.field);
  const fields = [...new Set(series.flatMap((s) => s.columns.map((c) => c.field ?? y)))];
  const rows = shared
    ? [
        [x, ...series.flatMap((s) => s.columns.map((c) => label(s, c)))],
        ...first.xs.map((value, i) => [value, ...series.flatMap((s) => s.columns.map((c) => c.values[i]))]),
      ]
    : [
        ["trace", x, ...fields],
        ...series.flatMap((s) =>
          s.xs.map((value, i) => [
            s.name,
            value,
            ...fields.map((field) => s.columns.find((c) => (c.field ?? y) === field)?.values[i]),
          ]),
        ),
      ];
  return rows.map(csvLine).join("\n");
}

function summary(figure) {
  return {
    title: titleOf(figure.layout),
    traces: figure.data.map((trace) => {
      const grid = trace.z !== undefined;
      const ranged = POINT_FIELDS[trace.type] && [...(valuesOf(trace.low) ?? []), ...(valuesOf(trace.high) ?? [])];
      const values = ((grid ? valuesOf(trace.z) : (valuesOf(trace.y) ?? valuesOf(trace.values) ?? ranged)) ?? []).flat();
      const numbers = values.filter((v) => typeof v === "number" && Number.isFinite(v));
      const points = grid ? values : (valuesOf(trace.x) ?? valuesOf(trace.labels) ?? valuesOf(trace.close) ?? values);
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
    const rows = () => rowsOf(model.get("data"));
    const drawn = () => document.querySelector(".plotly-chart.js-plotly-plot");
    const svg = async () => {
      const graph = drawn();
      if (!graph) return null;
      const url = await window.Plotly.toImage(graph, { format: "svg", width: graph.clientWidth, height: graph.clientHeight });
      return decodeURIComponent(url.slice(url.indexOf(",") + 1));
    };
    return {
      async exportOptions() {
        const svgOption = (label) => (drawn() ? [{ id: "svg", label, extension: "svg", mime: "image/svg+xml" }] : []);
        if (rows())
          return [
            { id: "csv", label: "Rows (CSV)", extension: "csv", mime: "text/csv" },
            { id: "rows", label: "Rows (JSON)", extension: "json", mime: "application/json" },
            ...svgOption("Table (SVG)"),
          ];
        const figure = current();
        if (!figure) return [];
        const options = [{ id: "figure", label: "Figure (Plotly JSON)", extension: "json", mime: "application/json" }];
        if (csvOf(figure)) options.unshift({ id: "csv", label: "Data (CSV)", extension: "csv", mime: "text/csv" });
        return [...options, ...svgOption("Chart (SVG)")];
      },
      async exportData(id) {
        const table = rows();
        if (table) {
          const columns = columnsOf(table);
          if (id === "csv") return [columns, ...table.map((row) => columns.map((c) => cellOf(row[c])))].map(csvLine).join("\n");
          if (id === "rows") return JSON.stringify(table, null, 2);
          return id === "svg" ? svg() : null;
        }
        const figure = current();
        if (!figure) return null;
        if (id === "csv") return csvOf(figure);
        if (id === "figure") return JSON.stringify(model.get("data"), null, 2);
        return id === "svg" ? svg() : null;
      },
      async copilotContext() {
        const figure = current();
        return figure ? summary(figure) : null;
      },
    };
  },

  async render({ model, el, signal, experimental }) {
    const Plotly = await loadPlotly();
    const invoke = (name, msg, options) => experimental.invoke(name, msg, options);
    const graph = document.createElement("div");
    graph.className = "plotly-chart";
    const message = document.createElement("p");
    message.className = "plotly-message";
    el.replaceChildren(graph, message);

    let pending = false;
    let latest = 0;
    let onBase = false;
    let followsMode = false;
    const draw = async () => {
      pending = !el.clientWidth || !el.clientHeight;
      if (pending) return;
      const turn = ++latest;
      const response = model.get("data");
      const table = rowsOf(response);
      const mode = model.get("theme")?.mode;
      const authored = table ? null : figureOf(response);
      followsMode = Boolean(table) || Boolean(authored && followsTheme(authored));
      const figure = table ? tableOf(table, mode) : authored && themedFigure(authored, mode);
      if (!figure) {
        Plotly.purge(graph);
        message.textContent = "The endpoint did not return a Plotly figure.";
        return;
      }
      try {
        const outlines = topojsonNames(figure);
        if (outlines.length) await loadOutlines(invoke, outlines);
        if (hasLatex(figure.layout) || figure.data.some((trace) => hasLatex(trace)))
          await loadMathJax(invoke).catch((error) => console.warn("MathJax:", error));
        if (turn !== latest || signal.aborted) return;
        message.textContent = "";
        const show = (shown) =>
          Plotly.react(graph, {
            data: shown.data,
            layout: shown.layout,
            frames: shown.frames,
            config: { responsive: true, displaylogo: false, modeBarButtonsToRemove: ["toImage"] },
          });
        const maps = mapSubplots(figure);
        onBase = false;
        try {
          await show(withMapStyle(figure, maps));
        } catch (error) {
          if (!maps.length) throw error;
          Plotly.purge(graph);
          const mode = model.get("theme")?.mode === "light" ? "light" : "dark";
          const base = await loadBaseStyle(invoke, mode);
          if (turn !== latest || signal.aborted) return;
          onBase = true;
          await show(withMapStyle(figure, maps, base));
        }
      } catch (error) {
        if (turn !== latest || signal.aborted) return;
        Plotly.purge(graph);
        message.textContent = `The chart could not be drawn: ${error?.message ?? error}`;
      }
    };
    model.on("change:data", draw);
    model.on("change:theme", () => (followsMode || onBase) && draw());
    draw();

    const resize = new ResizeObserver(() => (pending ? draw() : Plotly.Plots.resize(graph)));
    resize.observe(el);
    signal.addEventListener("abort", () => {
      resize.disconnect();
      Plotly.purge(graph);
    });
  },
};
