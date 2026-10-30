/*
 * OpenBB's ChartView: the table shown as an AG Grid integrated chart, linked to the rows, which
 * the toolbar switches to and from. `chartView`: { enabled, chartType, cellRangeCols,
 * ignoreCellRange, chartNavigatorEnabled, chartMiniChartEnabled }. The chart the user arranges
 * is saved to the widget's state and restored, unless `ignoreCellRange`.
 */

export const CHART_TYPES = [
  "column", "groupedColumn", "stackedColumn", "normalizedColumn",
  "bar", "groupedBar", "stackedBar", "normalizedBar",
  "line", "scatter", "bubble",
  "pie", "donut", "doughnut",
  "area", "stackedArea", "normalizedArea",
  "histogram", "radarLine", "radarArea", "nightingale", "radialColumn", "radialBar",
  "sunburst", "rangeBar", "rangeArea", "boxPlot", "treemap", "heatmap", "waterfall",
  "columnLineCombo", "areaColumnCombo", "customCombo",
];

const CARTESIAN = new Set([
  "column", "groupedColumn", "stackedColumn", "normalizedColumn", "bar", "groupedBar", "stackedBar",
  "normalizedBar", "line", "scatter", "bubble", "area", "stackedArea", "normalizedArea", "histogram",
  "rangeBar", "rangeArea", "boxPlot", "waterfall", "columnLineCombo", "areaColumnCombo", "customCombo",
]);

/** AG Grid has no plain `column`: OpenBB's `column` is its grouped column. */
export function agChartType(chartType) {
  if (chartType === "column") return "groupedColumn";
  if (chartType === "bar") return "groupedBar";
  return CHART_TYPES.includes(chartType) ? chartType : "groupedColumn";
}

const MAX_SAVED_MODEL = 32 * 1024;

export function chartThemeName(mode) {
  return mode === "light" ? "ag-default" : "ag-default-dark";
}

export function navigatorOverrides(chartView, chartType) {
  if (!CARTESIAN.has(chartType)) return undefined;
  const navigator = chartView?.chartNavigatorEnabled === true;
  const mini = chartView?.chartMiniChartEnabled === true;
  if (!navigator && !mini) return undefined;
  return { common: { navigator: { enabled: true, ...(mini ? { miniChart: { enabled: true } } : {}) } } };
}

/**
 * The columns a chart starts with: `cellRangeCols[chartType]` when it names existing columns,
 * else the first category or time column followed by every series column.
 */
export function chartColumns(columns, chartView, chartType) {
  const ids = columns.map((c) => c.id);
  const configured = chartView?.cellRangeCols?.[chartType] ?? chartView?.cellRangeCols?.[agChartType(chartType)];
  if (Array.isArray(configured)) {
    const known = configured.filter((id) => ids.includes(id));
    if (known.length) return known;
  }
  const usable = columns.filter((c) => !c.hide && c.chartDataType !== "excluded" && c.id !== "__field");
  const category = usable.find((c) => c.chartDataType === "category" || c.chartDataType === "time") ?? usable.find((c) => !c.numeric);
  const series = usable.filter((c) => c !== category && (c.chartDataType === "series" || (!c.chartDataType && c.numeric)));
  return [category, ...series].filter(Boolean).map((c) => c.id);
}

function columnsOf(api) {
  return (api.getColumns?.() ?? []).map((column) => {
    const def = column.getColDef();
    return {
      id: column.getColId(),
      hide: !column.isVisible(),
      chartDataType: def.chartDataType,
      numeric: def.type === "numericColumn" || def.filter === "agNumberColumnFilter",
    };
  });
}

/**
 * Manages the chart for one grid. `onChange({ open, model })` is called when the view or the
 * chart changes, to save it.
 */
export function createChartView({ api, gridEl, chartEl, chartView = {}, saved, mode, onChange }) {
  let ref = null;
  let open = false;
  let currentMode = mode;
  const type = agChartType(chartView.chartType);

  const save = () => {
    let model = null;
    try {
      const models = api.getChartModels?.() ?? [];
      model = models.find((m) => m.chartId === ref?.chartId) ?? null;
      if (model && JSON.stringify(model).length > MAX_SAVED_MODEL) model = null;
    } catch {
      model = null;
    }
    onChange?.({ open, model });
  };

  const create = (model, restore = chartView.ignoreCellRange !== true) => {
    if (model && restore) {
      try {
        ref = api.restoreChart({ ...model, chartThemeName: chartThemeName(currentMode) }, chartEl);
        if (ref) return;
      } catch (e) {
        console.warn("ag-grid restoreChart:", e.message);
      }
    }
    ref = api.createRangeChart({
      chartType: type,
      cellRange: { columns: chartColumns(columnsOf(api), chartView, chartView.chartType) },
      chartThemeName: chartThemeName(currentMode),
      chartContainer: chartEl,
      suppressChartRanges: true,
      chartThemeOverrides: navigatorOverrides(chartView, type),
    }) ?? null;
  };

  const destroyChart = () => {
    if (ref) {
      try { ref.destroyChart(); } catch { /* already gone */ }
      ref = null;
    }
    chartEl.replaceChildren();
  };

  const show = (next) => {
    open = next;
    gridEl.style.visibility = open ? "hidden" : "visible";
    chartEl.style.visibility = open ? "visible" : "hidden";
    chartEl.style.pointerEvents = open ? "auto" : "none";
  };

  const listener = () => save();
  api.addEventListener("chartOptionsChanged", listener);
  api.addEventListener("chartRangeSelectionChanged", listener);

  const view = {
    get isOpen() { return open; },
    open() {
      if (!ref) {
        try { create(saved?.model); } catch (e) { console.warn("ag-grid createRangeChart:", e.message); }
      }
      show(true);
      save();
      return ref !== null;
    },
    close() {
      show(false);
      save();
    },
    /** Draws the chart again in the site's new mode, keeping what the user arranged. */
    setMode(nextMode) {
      currentMode = nextMode;
      if (!ref) return;
      let model = null;
      try { model = (api.getChartModels?.() ?? []).find((m) => m.chartId === ref.chartId) ?? null; } catch { model = null; }
      destroyChart();
      try { create(model, true); } catch (e) { console.warn("ag-grid chart theme:", e.message); }
    },
    destroy() {
      api.removeEventListener("chartOptionsChanged", listener);
      api.removeEventListener("chartRangeSelectionChanged", listener);
      destroyChart();
    },
  };

  show(false);
  if (saved?.open ?? chartView.enabled === true) view.open();
  return view;
}
