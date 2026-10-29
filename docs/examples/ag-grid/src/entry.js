import * as agGridCommunity from "ag-grid-community";

let agGridEnterprise = null;
let AgChart = null;

const THEME_LIGHT = "ag-theme-quartz";
const THEME_DARK = "ag-theme-quartz-dark";

function themeClass(mode) {
  return mode === "light" ? THEME_LIGHT : THEME_DARK;
}

const CHART_THEMES = ["ag-default", "ag-vivid", "ag-polychroma", "ag-sheets", "ag-material"];

function chartThemesFor(mode) {
  return mode === "light" ? CHART_THEMES : CHART_THEMES.map((name) => `${name}-dark`);
}

function rowIdOf(row, index) {
  if (row && typeof row === "object" && row.id !== undefined) return String(row.id);
  return String(index);
}

function diffRows(oldRows, newRows) {
  const add = [];
  const update = [];
  const remove = [];
  const oldById = new Map();
  oldRows.forEach((r, i) => oldById.set(rowIdOf(r, i), { row: r, index: i }));
  const seenNew = new Set();
  newRows.forEach((r, i) => {
    const id = rowIdOf(r, i);
    seenNew.add(id);
    const old = oldById.get(id);
    if (old === undefined) add.push(r);
    else if (JSON.stringify(old.row) !== JSON.stringify(r)) update.push(r);
  });
  oldRows.forEach((r, i) => {
    const id = rowIdOf(r, i);
    if (!seenNew.has(id)) remove.push(r);
  });
  return { add, update, remove };
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function inferType(value) {
  if (value === null || value === undefined) return "empty";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return Number.isFinite(value) ? "numeric" : "empty";
  if (typeof value === "string") {
    if (value === "") return "empty";
    if (ISO_DATE_RE.test(value)) return "date";
    return "string";
  }
  return "object";
}

function inferColumnType(values) {
  const counts = {};
  for (const v of values) {
    const t = inferType(v);
    counts[t] = (counts[t] || 0) + 1;
  }
  const order = ["boolean", "numeric", "date", "string", "object"];
  let best = "string";
  let bestCount = 0;
  for (const t of order) {
    const c = counts[t] || 0;
    if (c > bestCount) { best = t; bestCount = c; }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/*  Enterprise modules (charts, sparklines)                           */
/* ------------------------------------------------------------------ */

async function loadEnterprise(licenseKey) {
  if (agGridEnterprise) return agGridEnterprise;
  try {
    agGridEnterprise = await import("ag-grid-enterprise");
  } catch {
    return null;
  }
  if (!licenseKey || !agGridEnterprise.LicenseManager) return agGridEnterprise;
  try {
    agGridEnterprise.LicenseManager.setLicenseKey(licenseKey);
  } catch (e) {
    console.warn("ag-grid enterprise license:", e.message);
  }
  return agGridEnterprise;
}

async function loadAgChart() {
  if (AgChart) return AgChart;
  try {
    const mod = await import("ag-charts-community");
    // ag-charts-community exports AgCharts (named) + setupCommunityModules
    const AgCharts = mod.AgCharts || mod.default?.AgCharts;
    if (AgCharts && mod.setupCommunityModules) {
      mod.setupCommunityModules();
    }
    AgChart = AgCharts;
  } catch {
    AgChart = null;
  }
  return AgChart;
}

function normalizeData(data, definition) {
  const def = definition && typeof definition === "object" ? definition : {};
  const config = {
    groupBy: Array.isArray(def.groupBy) ? def.groupBy : [],
    rowSpan: Array.isArray(def.rowSpan) ? def.rowSpan : [],
    pivot: Array.isArray(def.pivot) ? def.pivot : [],
    format: def.format || "auto",
  };

  /* Ag-grid-ready object: { columnDefs, rowData, gridOptions? } */
  if (
    data && typeof data === "object" && !Array.isArray(data) &&
    (Array.isArray(data.columnDefs) || Array.isArray(data.rowData))
  ) {
    const cd = Array.isArray(data.columnDefs) ? data.columnDefs : [];
    const rd = Array.isArray(data.rowData) ? data.rowData : [];
    return { rowData: rd, columnDefs: compactColumnDefs(cd, rd), config, gridOptions: data.gridOptions || {} };
  }

  let payload = data;
  let columns = [];

  /* List of records: pandas to_dict('records') -> [{a:1}, {a:2}] */
  if (Array.isArray(payload)) {
    columns = payload.length > 0 ? Object.keys(payload[0]) : [];
    return { rowData: payload, columnDefs: buildColumnDefs(payload, columns, config), config, gridOptions: {} };
  }

  /* Object forms */
  if (payload && typeof payload === "object") {
    /* Pandas split: { columns, index, data } */
    if (Array.isArray(payload.columns) && Array.isArray(payload.data)) {
      columns = payload.columns;
      const rowData = payload.data.map((row) => {
        const obj = {};
        columns.forEach((c, j) => { obj[c] = row[j]; });
        return obj;
      });
      return { rowData, columnDefs: buildColumnDefs(rowData, columns, config), config, gridOptions: {} };
    }

    /* Dict of columns: pandas to_dict('list') -> {a: [1,2], b: [3,4]} */
    /* Also: { data: {...}, columns: [...] } */
    const colData = payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
      ? payload.data
      : payload;

    columns = Object.keys(colData);
    if (columns.length > 0) {
      const firstCol = columns[0];
      const len = colData[firstCol] && Array.isArray(colData[firstCol]) ? colData[firstCol].length : 0;
      const rowData = Array.from({ length: len }, (_, i) => {
        const obj = {};
        columns.forEach((c) => { obj[c] = colData[c] && colData[c][i]; });
        return obj;
      });
      return { rowData, columnDefs: buildColumnDefs(rowData, columns, config), config, gridOptions: {} };
    }
  }

  return { rowData: [], columnDefs: [], config, gridOptions: {} };
}

function buildColumnDefs(rowData, columns, config) {
  return columns.map((field) => {
    const values = rowData.map((r) => r[field]);
    const type = inferColumnType(values);
    const def = { field, headerName: field.charAt(0).toUpperCase() + field.slice(1), resizable: true, sortable: true, filter: true };
    if (type === "numeric") { def.filter = "agNumberColumnFilter"; def.type = ["numericColumn"]; def.valueFormatter = formatNumber; }
    else if (type === "date") { def.filter = "agDateColumnFilter"; }
    else if (type === "boolean") { def.filter = "agTextColumnFilter"; def.cellRenderer = (params) => (params.value ? "Yes" : "No"); }
    if (config.groupBy.includes(field)) { def.rowGroup = true; def.hide = true; }
    if (config.rowSpan.includes(field)) {
      def.cellClassRules = { "row-span": (params) => params.data && params.data[field] !== undefined };
    }
    return def;
  });
}

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 });

function formatNumber(params) {
  return typeof params.value === "number" && Number.isFinite(params.value) ? numberFormat.format(params.value) : params.value;
}

function compactColumnDefs(defs, rows) {
  return defs.map((def) => {
    if (Array.isArray(def.children)) return { ...def, children: compactColumnDefs(def.children, rows) };
    if (!def.field || def.type || def.valueFormatter || def.cellRenderer) return def;
    const first = rows.find((r) => r && r[def.field] !== null && r[def.field] !== undefined);
    return first && typeof first[def.field] === "number"
      ? { ...def, type: "numericColumn", valueFormatter: formatNumber }
      : def;
  });
}

function numericStats(rows, columns) {
  const stats = {};
  for (const col of columns) {
    const values = rows.map((r) => r[col]).filter((v) => typeof v === "number" && !Number.isNaN(v));
    if (values.length === 0) continue;
    const sum = values.reduce((a, b) => a + b, 0);
    stats[col] = { count: values.length, min: Math.min(...values), max: Math.max(...values), sum, avg: sum / values.length };
  }
  return stats;
}

export { chartThemesFor, themeClass, rowIdOf, diffRows, inferType, inferColumnType, normalizeData, numericStats, compactColumnDefs };

let api = null;
let licensePromise = null;
let currentRowData = [];
let currentColumnDefs = [];
let currentGridOptions = {};
let container = null;
let resizeObserver = null;

/* --- Module-level state shared by initialize + render --- */
const gridState = {
  selection: [],
  lastEvent: null,
  rowCount: 0,
  columnCount: 0,
  filterModel: null,
  sortModel: null,
  columnState: null,
  charts: [],
};

const persistState = (model) => {
  try { model.set("state", { ...gridState }); model.save_changes(); }
  catch (e) { console.warn("ag-grid state write:", e.message); }
};

const recordEvent = (model, kind, detail) => {
  gridState.lastEvent = { kind, detail, timestamp: Date.now() };
  persistState(model);
};

export default {
  initialize({ model, signal, experimental }) {
    const adminSettings = model.get("adminSettings") || {};
    const config = model.get("config") || {};
    const licenseKey = config.licenseKey || adminSettings.licenseKey || "";
    licensePromise = loadEnterprise(licenseKey);

    const exportOptions = () => [{ id: "csv", label: "Rows (CSV)", extension: "csv", mime: "text/csv" }];

    const exportData = (id) => {
      if (id !== "csv" || !api) return null;
      try { return api.exportDataAsCsv({ fileName: "ag-grid-export.csv" }); }
      catch (e) { console.warn("ag-grid exportData:", e); return null; }
    };

    const copilotContext = () => {
      if (!api) return null;
      let rd = [];
      if (typeof api.getRowData === "function") {
        try { rd = api.getRowData() || []; } catch { rd = []; }
      } else if (typeof api.getRows === "function") {
        try { rd = api.getRows() || []; } catch { rd = []; }
      }
      const cols = typeof api.getColumnDefs === "function" ? api.getColumnDefs() : [];
      return {
        rowCount: rd.length, columnCount: cols.length,
        columns: cols.map((c) => c.field).filter(Boolean),
        selectionCount: gridState.selection.length,
        filterModel: gridState.filterModel, sortModel: gridState.sortModel,
        stats: numericStats(rd, cols.map((c) => c.field).filter(Boolean)),
      };
    };

    let currentRowData = [];
    let currentColumnDefs = [];
    let currentGridOptions = {};
    let container = null;
    let resizeObserver = null;

    const applyStreamingUpdate = (newRowData) => {
      if (!api) return;
      const next = Array.isArray(newRowData) ? newRowData : [];
      const { add, update, remove } = diffRows(currentRowData, next);
      if (add.length === 0 && update.length === 0 && remove.length === 0) { currentRowData = next; return; }
      try { api.applyTransaction({ add, update, remove }); }
      catch (e) { console.warn("ag-grid applyTransaction:", e.message); api.setRowData(next); }
      currentRowData = next;
    };

    const onSelectionChanged = () => {
      const nodes = api.getSelectedNodes();
      gridState.selection = nodes.map((n) => ({ id: n.id, data: n.data }));
      gridState.rowCount = api.getDisplayedRowCount();
      recordEvent(model, "selectionChanged", { count: nodes.length });
    };

    const onCellValueChanged = async (event) => {
      const field = event.colDef?.colDef?.field ?? event.colDef?.field;
      const rowIndex = event.rowIndex;
      const oldValue = event.oldValue;
      const newValue = event.newValue;

      // Record local event
      recordEvent(model, "cellValueChanged", {
        rowIndex,
        colDef: field,
        oldValue,
        newValue,
      });

      // Get the row data to find the row ID
      const rowNode = api.getDisplayedRowAtIndex(rowIndex);
      if (!rowNode || !rowNode.data) return;
      const rowData = rowNode.data;
      const rowId = rowData.id ?? rowIndex;

      // Call backend to persist the edit
      if (experimental && experimental.invoke) {
        try {
          const result = await experimental.invoke("core:backend:call", {
            method: "POST",
            path: "/sales/edit",
            body: { rowId, field, newValue },
          });
          // Backend returns the updated row - apply it
          if (result && result.updated) {
            // Find and update the row in currentRowData
            const idx = currentRowData.findIndex((r) => (r.id ?? currentRowData.indexOf(r)) === rowId);
            if (idx >= 0) {
              currentRowData[idx] = { ...currentRowData[idx], [field]: newValue };
              api.applyTransaction({ update: [currentRowData[idx]] });
            }
          }
        } catch (e) {
          console.warn("cell edit invoke failed:", e.message);
        }
      }
    };

    const onRowDataChanged = () => {
      gridState.rowCount = api.getDisplayedRowCount();
      gridState.columnCount = (api.getColumnDefs() || []).length;
      recordEvent(model, "rowDataChanged", { rowCount: gridState.rowCount });
    };

    const onFilterChanged = () => {
      const fm = api.getFilterModel();
      gridState.filterModel = fm;
      recordEvent(model, "filterChanged", { filterModel: fm });
    };

    const onSortChanged = () => {
      const sm = api.getSortModel();
      gridState.sortModel = sm;
      recordEvent(model, "sortChanged", { sortModel: sm });
    };

    const onColumnResized = () => {
      gridState.columnState = api.getColumnState();
      recordEvent(model, "columnResized", { columnState: gridState.columnState });
    };

    const onColumnMoved = () => {
      gridState.columnState = api.getColumnState();
      recordEvent(model, "columnMoved", { columnState: gridState.columnState });
    };

    const onCellClicked = (event) => {
      recordEvent(model, "cellClicked", {
        rowIndex: event.rowIndex,
        colDef: event.colDef?.colDef?.field ?? event.colDef?.field,
        value: event.value,
      });
    };

    return { exportOptions, exportData, copilotContext };
  },

  async render({ model, el, signal }) {
    await licensePromise;

    el.replaceChildren();

    const theme = model.get("theme") || {};
    const mode = theme?.mode ?? "light";

    const data = model.get("data") || {};
    const definition = model.get("definition") || {};
    const config = model.get("config") || {};

    const { rowData, columnDefs: inferredColumnDefs, config: inferredConfig, gridOptions: inferredGridOptions } = normalizeData(data, definition);
    const gridOptions = inferredGridOptions || {};

    currentColumnDefs = inferredColumnDefs;
    currentRowData = rowData;
    currentGridOptions = gridOptions;

    const chartConfig = definition.chart || config.chart || {};
    const showChart = chartConfig.enabled && (agGridEnterprise || AgChart);
    const gridPct = showChart ? chartConfig.gridWidth ?? 70 : 100;

    container = document.createElement("div");
    container.className = "ag-grid-container";
    container.style.height = "100%";
    container.style.width = "100%";
    container.style.display = "flex";
    container.style.flexDirection = "row";
    el.appendChild(container);

    const gridWrapper = document.createElement("div");
    gridWrapper.className = "ag-grid-wrapper";
    gridWrapper.style.flex = `0 0 ${gridPct}%`;
    gridWrapper.style.height = "100%";
    container.appendChild(gridWrapper);

    const gridEl = document.createElement("div");
    gridEl.className = themeClass(mode);
    gridEl.style.height = "100%";
    gridEl.style.width = "100%";
    gridWrapper.appendChild(gridEl);


    let chartContainer = null;
    let chart = null;
    let standaloneChart = null;

    if (showChart) {
      chartContainer = document.createElement("div");
      chartContainer.className = "ag-grid-chart-container";
      chartContainer.style.flex = `0 0 ${100 - gridPct}%`;
      chartContainer.style.height = "100%";
      chartContainer.style.borderLeft = "1px solid var(--border, #e2e8f0)";
      container.appendChild(chartContainer);
    }

    const enterpriseOptions = agGridEnterprise
      ? {
          sideBar: { toolPanels: ["columns", "filters"], defaultToolPanel: "" },
          rowGroupPanelShow: "onlyWhenGrouping",
          pivotPanelShow: "onlyWhenPivoting",
          suppressAggFuncInHeader: true,
          cellSelection: true,
          enableCharts: true,
          chartThemes: chartThemesFor(mode),
          popupParent: document.body,
          statusBar: {
            statusPanels: [
              { statusPanel: "agTotalAndFilteredRowCountComponent", align: "left" },
              { statusPanel: "agAggregationComponent", align: "right" },
            ],
          },
        }
      : {};
    const hasIds = rowData.length > 0 && rowData.every((r) => r && r.id !== undefined);
    const mergedOptions = {
      pagination: rowData.length > 100,
      paginationAutoPageSize: true,
      paginationPageSizeSelector: false,
      suppressDragLeaveHidesColumns: true,
      stopEditingWhenCellsLoseFocus: true,
      tooltipShowDelay: 400,
      ...enterpriseOptions,
      ...(hasIds ? { getRowId: (params) => String(params.data.id) } : {}),
      columnDefs: inferredColumnDefs,
      rowData,
      ...gridOptions,
      animateRows: true,
      enableCellTextSelection: !agGridEnterprise,
      suppressScrollOnNewData: true,
      groupDefaultExpanded: 1,
      autoGroupColumnDef: { headerName: "Group", minWidth: 160 },
      defaultColDef: {
        resizable: true,
        sortable: true,
        filter: true,
        editable: false,
        flex: 1,
        minWidth: 70,
        suppressHeaderFilterButton: true,
        ...(agGridEnterprise ? { enableRowGroup: true, enablePivot: true, enableValue: true } : {}),
        ...(gridOptions.defaultColDef || {}),
      },
    };

    /* --- Event handlers (defined here so they close over render() scope) --- */
    const onSelectionChanged = () => {
      const nodes = api.getSelectedNodes();
      gridState.selection = nodes.map((n) => ({ id: n.id, data: n.data }));
      gridState.rowCount = api.getDisplayedRowCount();
      recordEvent(model, "selectionChanged", { count: nodes.length });
    };
    const onCellValueChanged = (event) => {
      recordEvent(model, "cellValueChanged", {
        rowIndex: event.rowIndex,
        colDef: event.colDef?.colDef?.field ?? event.colDef?.field,
        oldValue: event.oldValue, newValue: event.newValue,
      });
    };
    const onRowDataChanged = () => {
      gridState.rowCount = api.getDisplayedRowCount();
      gridState.columnCount = (api.getColumnDefs() || []).length;
      recordEvent(model, "rowDataChanged", { rowCount: gridState.rowCount });
    };
    const onFilterChanged = () => {
      const fm = api.getFilterModel();
      gridState.filterModel = fm;
      recordEvent(model, "filterChanged", { filterModel: fm });
    };
    const onSortChanged = () => {
      const sm = api.getSortModel();
      gridState.sortModel = sm;
      recordEvent(model, "sortChanged", { sortModel: sm });
    };
    const onColumnResized = () => {
      gridState.columnState = api.getColumnState();
      recordEvent(model, "columnResized", { columnState: gridState.columnState });
    };
    const onColumnMoved = () => {
      gridState.columnState = api.getColumnState();
      recordEvent(model, "columnMoved", { columnState: gridState.columnState });
    };
    const onCellClicked = (event) => {
      recordEvent(model, "cellClicked", {
        rowIndex: event.rowIndex,
        colDef: event.colDef?.colDef?.field ?? event.colDef?.field,
        value: event.value,
      });
    };

    const gridApi = agGridCommunity.createGrid(gridEl, mergedOptions);
    api = gridApi;
    api.addEventListener("selectionChanged", onSelectionChanged);
    api.addEventListener("cellValueChanged", onCellValueChanged);
    api.addEventListener("rowDataChanged", onRowDataChanged);
    api.addEventListener("filterChanged", onFilterChanged);
    api.addEventListener("sortChanged", onSortChanged);
    api.addEventListener("columnResized", onColumnResized);
    api.addEventListener("columnMoved", onColumnMoved);
    api.addEventListener("cellClicked", onCellClicked);

    gridState.rowCount = api.getDisplayedRowCount();
    gridState.columnCount = inferredColumnDefs.length;
    persistState(model);

    if (showChart && chartContainer) {
      /* Path 1: AG Grid Enterprise integrated charts (createRangeChart) */
      if (agGridEnterprise && api.createRangeChart) {
        try {
          const chartDefaults = {
            chartType: chartConfig.chartType || "groupedColumn",
            chartTheme: mode === "light" ? "quarts" : "ag-dark",
            container: chartContainer,
          };

          const cellRange = chartConfig.cellRange || {
            rowStartIndex: 0,
            rowEndIndex: rowData.length - 1,
            columns: inferredColumnDefs.map((c) => c.field).filter((f) => f !== "id"),
          };

          chart = api.createRangeChart({ ...chartDefaults, cellRange });
          gridState.charts.push({ id: chart.getChartId(), type: chartDefaults.chartType, source: "enterprise" });
          persistState(model);

          chart.addEventListener("chartRangeChanged", () => {
            gridState.charts = gridState.charts.map((c) => c.id === chart.getChartId() ? { ...c, lastEvent: "chartRangeChanged", timestamp: Date.now() } : c);
            persistState(model);
          });
        } catch (e) {
          console.warn("ag-grid enterprise chart creation:", e.message);
        }
      }
      /* Path 2: AG Charts Community standalone charts (free, no license key) */
      if (!chart && AgChart) {
        try {
          const agChart = await loadAgChart();
          if (agChart) {
            const seriesCols = inferredColumnDefs
              .map((c) => c.field)
              .filter((f) => f !== "id" && f !== "group")
              .slice(0, 4);
            const categoryCol = inferredColumnDefs.find((c) => c.field !== "id")?.field || inferredColumnDefs[0]?.field;

            standaloneChart = agChart.create({
              container: chartContainer,
              title: { text: chartConfig.title || "Chart" },
              data: rowData,
              series: seriesCols.map((col) => ({ type: "line", xKey: categoryCol, yKey: col })),
              theme: mode === "light" ? "quarts" : "ag-dark",
              width: chartContainer.clientWidth || 300,
              height: chartContainer.clientHeight || 300,
            });
            gridState.charts.push({ id: "standalone-" + Date.now(), type: chartConfig.chartType || "line", source: "community" });
            persistState(model);
          }
        } catch (e) {
          console.warn("ag-charts-community chart creation:", e.message);
        }
      }
    }

    const onDataChange = () => {
      const data = model.get("data") || {};
      const definition = model.get("definition") || {};
      const next = normalizeData(data, definition);
      const nextRowData = next.rowData;
      const nextInferredColumnDefs = next.columnDefs;
      const nextGridOptions = next.gridOptions || {};
      if (JSON.stringify(nextInferredColumnDefs) !== JSON.stringify(currentColumnDefs)) {
        currentColumnDefs = nextInferredColumnDefs;
        api.setColumnDefs(nextInferredColumnDefs);
      }
      if (JSON.stringify(nextGridOptions) !== JSON.stringify(currentGridOptions)) {
        currentGridOptions = nextGridOptions;
        Object.entries(nextGridOptions).forEach(([k, v]) => { try { api.setGridOption(k, v); } catch { } });
      }
      applyStreamingUpdate(nextRowData);
    };

    const onThemeChange = async () => {
      const theme = model.get("theme") || {};
      const mode = theme?.mode ?? "light";
      gridEl.classList.remove(THEME_LIGHT, THEME_DARK);
      gridEl.classList.add(themeClass(mode));
      if (agGridEnterprise) api.setGridOption("chartThemes", chartThemesFor(mode));

      /* Recreate enterprise chart */
      if (chart) {
        try { chart.destroy(); } catch { }
        chart = null;
        if (showChart && chartContainer && agGridEnterprise && api.createRangeChart) {
          try {
            chart = api.createRangeChart({
              chartType: chartConfig.chartType || "groupedColumn",
              chartTheme: mode === "light" ? "quarts" : "ag-dark",
              container: chartContainer,
              cellRange: chartConfig.cellRange || {
                rowStartIndex: 0,
                rowEndIndex: rowData.length - 1,
                columns: inferredColumnDefs.map((c) => c.field).filter((f) => f !== "id"),
              },
            });
            gridState.charts = gridState.charts.filter((c) => c.source !== "enterprise");
            gridState.charts.push({ id: chart.getChartId(), type: chartConfig.chartType || "groupedColumn", source: "enterprise" });
            persistState(model);
          } catch (e) {
            console.warn("ag-grid chart recreation:", e.message);
          }
        }
      }

      /* Recreate community standalone chart */
      if (standaloneChart) {
        try { standaloneChart.destroy(); } catch { }
        standaloneChart = null;
        if (showChart && chartContainer && AgChart) {
          try {
            const agChart = await loadAgChart();
            if (agChart) {
              const seriesCols = inferredColumnDefs
                .map((c) => c.field)
                .filter((f) => f !== "id" && f !== "group")
                .slice(0, 4);
              const categoryCol = inferredColumnDefs.find((c) => c.field !== "id")?.field || inferredColumnDefs[0]?.field;

              standaloneChart = agChart.create({
                container: chartContainer,
                title: { text: chartConfig.title || "Chart" },
                data: rowData,
                series: seriesCols.map((col) => ({ type: "line", xKey: categoryCol, yKey: col })),
                theme: mode === "light" ? "quarts" : "ag-dark",
                width: chartContainer.clientWidth || 300,
                height: chartContainer.clientHeight || 300,
              });
              gridState.charts = gridState.charts.filter((c) => c.source !== "community");
              gridState.charts.push({ id: "standalone-" + Date.now(), type: chartConfig.chartType || "line", source: "community" });
              persistState(model);
            }
          } catch (e) {
            console.warn("ag-charts-community chart recreation:", e.message);
          }
        }
      }

      api.sizeColumnsToFit();
    };

    model.on("change:data", onDataChange);
    model.on("change:theme", onThemeChange);

    resizeObserver = new ResizeObserver(() => { if (api) api.sizeColumnsToFit(); });
    resizeObserver.observe(el);

    signal.addEventListener("abort", () => {
      model.off("change:data", onDataChange);
      model.off("change:theme", onThemeChange);
      api.removeEventListener("selectionChanged", onSelectionChanged);
      api.removeEventListener("cellValueChanged", onCellValueChanged);
      api.removeEventListener("rowDataChanged", onRowDataChanged);
      api.removeEventListener("filterChanged", onFilterChanged);
      api.removeEventListener("sortChanged", onSortChanged);
      api.removeEventListener("columnResized", onColumnResized);
      api.removeEventListener("columnMoved", onColumnMoved);
      api.removeEventListener("cellClicked", onCellClicked);
      if (chart) {
        try { chart.destroy(); } catch { }
        chart = null;
      }
      if (standaloneChart) {
        try { standaloneChart.destroy(); } catch { }
        standaloneChart = null;
      }
      resizeObserver.disconnect();
      api.destroy();
      api = null;
      container = null;
    });
  },
};
