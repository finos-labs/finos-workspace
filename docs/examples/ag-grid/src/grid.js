import * as agGridCommunity from "ag-grid-community";

const THEME_LIGHT = "ag-theme-quartz";
const THEME_DARK = "ag-theme-quartz-dark";
const CHART_THEMES = ["ag-default", "ag-vivid", "ag-polychroma", "ag-sheets", "ag-material"];

export function themeClass(mode) {
  return mode === "light" ? THEME_LIGHT : THEME_DARK;
}

export function chartThemesFor(mode) {
  return mode === "light" ? CHART_THEMES : CHART_THEMES.map((name) => `${name}-dark`);
}

export function setTheme(gridEl, api, mode) {
  gridEl.classList.remove(THEME_LIGHT, THEME_DARK);
  gridEl.classList.add(themeClass(mode));
  api.setGridOption("chartThemes", chartThemesFor(mode));
}

export function rowIdOf(row, index) {
  if (row && typeof row === "object" && row.id !== undefined) return String(row.id);
  return String(index);
}

export function hasIds(rows) {
  return rows.every((r) => r && r.id !== undefined);
}

export function diffRows(oldRows, newRows) {
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

export function inferType(value) {
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

export function inferColumnType(values) {
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

export async function loadEnterprise(licenseKey) {
  const enterprise = await import("ag-grid-enterprise");
  if (!licenseKey) return;
  try {
    enterprise.LicenseManager.setLicenseKey(licenseKey);
  } catch (e) {
    console.warn("ag-grid enterprise license:", e.message);
  }
}

export function licenseKeyOf(model) {
  const config = model.get("config") || {};
  const adminSettings = model.get("adminSettings") || {};
  return config.licenseKey || adminSettings.licenseKey || "";
}

export function normalizeData(data) {
  if (
    data && typeof data === "object" && !Array.isArray(data) &&
    (Array.isArray(data.columnDefs) || Array.isArray(data.rowData))
  ) {
    const cd = Array.isArray(data.columnDefs) ? data.columnDefs : [];
    const rd = Array.isArray(data.rowData) ? data.rowData : [];
    return { rowData: rd, columnDefs: compactColumnDefs(cd, rd), gridOptions: data.gridOptions || {} };
  }

  if (Array.isArray(data)) {
    const columns = data.length > 0 ? Object.keys(data[0]) : [];
    return { rowData: data, columnDefs: buildColumnDefs(data, columns), gridOptions: {} };
  }

  if (data && typeof data === "object") {
    if (Array.isArray(data.columns) && Array.isArray(data.data)) {
      const columns = data.columns;
      const rowData = data.data.map((row) => {
        const obj = {};
        columns.forEach((c, j) => { obj[c] = row[j]; });
        return obj;
      });
      return { rowData, columnDefs: buildColumnDefs(rowData, columns), gridOptions: {} };
    }

    const colData = data.data && typeof data.data === "object" && !Array.isArray(data.data) ? data.data : data;
    const columns = Object.keys(colData);
    if (columns.length > 0) {
      const firstCol = columns[0];
      const len = Array.isArray(colData[firstCol]) ? colData[firstCol].length : 0;
      const rowData = Array.from({ length: len }, (_, i) => {
        const obj = {};
        columns.forEach((c) => { obj[c] = colData[c] && colData[c][i]; });
        return obj;
      });
      return { rowData, columnDefs: buildColumnDefs(rowData, columns), gridOptions: {} };
    }
  }

  return { rowData: [], columnDefs: [], gridOptions: {} };
}

function buildColumnDefs(rowData, columns) {
  return columns.map((field) => {
    const type = inferColumnType(rowData.map((r) => r[field]));
    const def = { field, headerName: field.charAt(0).toUpperCase() + field.slice(1), resizable: true, sortable: true, filter: true };
    if (type === "numeric") { def.filter = "agNumberColumnFilter"; def.type = ["numericColumn"]; def.valueFormatter = formatNumber; }
    else if (type === "date") { def.filter = "agDateColumnFilter"; }
    else if (type === "boolean") { def.filter = "agTextColumnFilter"; def.cellRenderer = (params) => (params.value ? "Yes" : "No"); }
    return def;
  });
}

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 });

export function formatNumber(params) {
  return typeof params.value === "number" && Number.isFinite(params.value) ? numberFormat.format(params.value) : params.value;
}

export function compactColumnDefs(defs, rows) {
  return defs.map((def) => {
    if (Array.isArray(def.children)) return { ...def, children: compactColumnDefs(def.children, rows) };
    if (!def.field || def.valueFormatter) return def;
    if ([def.type].flat().includes("numericColumn")) return { ...def, valueFormatter: formatNumber };
    if (def.type || def.cellRenderer) return def;
    const first = rows.find((r) => r && r[def.field] !== null && r[def.field] !== undefined);
    return first && typeof first[def.field] === "number"
      ? { ...def, type: "numericColumn", valueFormatter: formatNumber }
      : def;
  });
}

export function numericStats(rows, columns) {
  const stats = {};
  for (const col of columns) {
    let count = 0;
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    for (const row of rows) {
      const v = row[col];
      if (typeof v !== "number" || Number.isNaN(v)) continue;
      count += 1;
      sum += v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (count > 0) stats[col] = { count, min, max, sum, avg: sum / count };
  }
  return stats;
}

export function rowsOf(gridApi) {
  const rows = [];
  gridApi.forEachNode((node) => { if (!node.group && node.data) rows.push(node.data); });
  return rows;
}

export function fieldsOf(gridApi) {
  return (gridApi.getColumns() || []).map((c) => c.getColDef().field).filter(Boolean);
}

export function sortModelOf(gridApi) {
  return gridApi
    .getColumnState()
    .filter((c) => c.sort)
    .sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0))
    .map(({ colId, sort }) => ({ colId, sort }));
}

export function groupingOf(gridApi) {
  const state = gridApi.getColumnState();
  return {
    rowGroups: state.filter((c) => c.rowGroup).map((c) => c.colId),
    pivots: state.filter((c) => c.pivot).map((c) => c.colId),
    values: state.filter((c) => c.aggFunc).map((c) => ({ colId: c.colId, aggFunc: c.aggFunc })),
    pivotMode: gridApi.isPivotMode(),
  };
}

export function toolPanels(mode) {
  return {
    sideBar: { toolPanels: ["columns", "filters"], defaultToolPanel: "" },
    rowGroupPanelShow: "always",
    pivotPanelShow: "always",
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
  };
}

export function gridOptionsFor({ mode, rowData, columnDefs, gridOptions = {}, keyed = false }) {
  return {
    pagination: rowData.length > 100,
    paginationAutoPageSize: true,
    paginationPageSizeSelector: false,
    suppressDragLeaveHidesColumns: true,
    stopEditingWhenCellsLoseFocus: true,
    tooltipShowDelay: 400,
    ...(keyed ? { getRowId: (params) => String(params.data.id) } : {}),
    columnDefs,
    rowData,
    ...gridOptions,
    ...toolPanels(mode),
    animateRows: true,
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
      enableRowGroup: true,
      enablePivot: true,
      enableValue: true,
      ...(gridOptions.defaultColDef || {}),
    },
  };
}

export function createGrid(el, options) {
  return agGridCommunity.createGrid(el, options);
}

export function createTracker(model) {
  const state = {
    selection: [],
    lastEvent: null,
    rowCount: 0,
    columnCount: 0,
    filterModel: null,
    sortModel: null,
    columnState: null,
  };

  const persist = () => {
    try { model.set("state", { ...state }); model.save_changes(); }
    catch (e) { console.warn("ag-grid state write:", e.message); }
  };

  const record = (kind, detail) => {
    state.lastEvent = { kind, detail, timestamp: Date.now() };
    persist();
  };

  const attach = (api) => {
    const fieldOf = (event) => event.colDef?.field;
    const handlers = {
      selectionChanged: () => {
        const nodes = api.getSelectedNodes();
        state.selection = nodes.map((n) => ({ id: n.id, data: n.data }));
        state.rowCount = api.getDisplayedRowCount();
        record("selectionChanged", { count: nodes.length });
      },
      cellValueChanged: (event) => {
        record("cellValueChanged", {
          rowIndex: event.rowIndex,
          colDef: fieldOf(event),
          oldValue: event.oldValue,
          newValue: event.newValue,
        });
      },
      rowDataUpdated: () => {
        state.rowCount = api.getDisplayedRowCount();
        record("rowDataUpdated", { rowCount: state.rowCount });
      },
      filterChanged: () => {
        state.filterModel = api.getFilterModel();
        record("filterChanged", { filterModel: state.filterModel });
      },
      sortChanged: () => {
        state.sortModel = sortModelOf(api);
        record("sortChanged", { sortModel: state.sortModel });
      },
      columnResized: (event) => {
        if (!event.finished) return;
        state.columnState = api.getColumnState();
        record("columnResized", { columnState: state.columnState });
      },
      columnMoved: (event) => {
        if (!event.finished) return;
        state.columnState = api.getColumnState();
        record("columnMoved", { columnState: state.columnState });
      },
      cellClicked: (event) => {
        record("cellClicked", { rowIndex: event.rowIndex, colDef: fieldOf(event), value: event.value });
      },
    };
    for (const [name, handler] of Object.entries(handlers)) api.addEventListener(name, handler);
    state.rowCount = api.getDisplayedRowCount();
    state.columnCount = fieldsOf(api).length;
    persist();
    return () => {
      for (const [name, handler] of Object.entries(handlers)) api.removeEventListener(name, handler);
    };
  };

  return { state, persist, record, attach };
}

export function clientExports(getApi) {
  return {
    exportOptions: () => [{ id: "csv", label: "Rows (CSV)", extension: "csv", mime: "text/csv" }],
    exportData: (id) => {
      const api = getApi();
      return id === "csv" && api ? api.getDataAsCsv() : null;
    },
    copilotContext: () => {
      const api = getApi();
      if (!api) return null;
      const rows = rowsOf(api);
      const columns = fieldsOf(api);
      return {
        rowCount: rows.length,
        columnCount: columns.length,
        columns,
        selectionCount: api.getSelectedNodes().length,
        filterModel: api.getFilterModel(),
        sortModel: sortModelOf(api),
        grouping: groupingOf(api),
        stats: numericStats(rows, columns),
      };
    },
  };
}
