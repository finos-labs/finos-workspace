import * as agGridCommunity from "ag-grid-community";
import { fieldsOf, inferColumnType, inferType } from "./infer.js";
import { createChartView } from "./ag-table-chart/chartView.js";
import { changeTrackedColumns, agTableChartColumnDefs, transpose } from "./ag-table-chart/columns.js";

let agGridEnterprise = null;

const THEME_LIGHT = "ag-theme-quartz";
const THEME_DARK = "ag-theme-quartz-dark";
const CHANGE_FLASH_MS = 1500;

function themeClass(mode) {
  return mode === "light" ? THEME_LIGHT : THEME_DARK;
}

const CHART_THEMES = ["ag-default", "ag-vivid", "ag-polychroma", "ag-sheets", "ag-material"];

function chartThemesFor(mode) {
  return mode === "light" ? CHART_THEMES : CHART_THEMES.map((name) => `${name}-dark`);
}

function rowIdOf(row, index, idField = "id") {
  if (row && typeof row === "object" && row[idField] !== undefined && row[idField] !== null) return String(row[idField]);
  return String(index);
}

function diffRows(oldRows, newRows, idField = "id") {
  const add = [];
  const update = [];
  const remove = [];
  const oldById = new Map();
  oldRows.forEach((r, i) => oldById.set(rowIdOf(r, i, idField), { row: r, index: i }));
  const seenNew = new Set();
  newRows.forEach((r, i) => {
    const id = rowIdOf(r, i, idField);
    seenNew.add(id);
    const old = oldById.get(id);
    if (old === undefined) add.push(r);
    else if (JSON.stringify(old.row) !== JSON.stringify(r)) update.push(r);
  });
  oldRows.forEach((r, i) => {
    const id = rowIdOf(r, i, idField);
    if (!seenNew.has(id)) remove.push(r);
  });
  return { add, update, remove };
}

/** The direction each tracked cell moved between two versions of the rows, by `<row id>|<field>`. */
function cellChanges(oldRows, newRows, tracked, idField = "id") {
  const changes = new Map();
  if (!tracked.length) return changes;
  const oldById = new Map(oldRows.map((r, i) => [rowIdOf(r, i, idField), r]));
  newRows.forEach((row, i) => {
    const id = rowIdOf(row, i, idField);
    const old = oldById.get(id);
    if (!old || !row) return;
    for (const { field, compareField } of tracked) {
      const before = old[compareField];
      const after = row[compareField];
      if (typeof before === "number" && typeof after === "number" && before !== after) {
        changes.set(`${id}|${field}`, after > before ? "up" : "down");
      }
    }
  });
  return changes;
}

/* ------------------------------------------------------------------ */
/*  Enterprise modules (integrated charts, sparklines, tool panels)    */
/* ------------------------------------------------------------------ */

async function loadEnterprise(licenseKey) {
  if (agGridEnterprise) return agGridEnterprise;
  try {
    agGridEnterprise = await import("ag-grid-charts-enterprise");
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

function rowsOf(data) {
  /* List of records: pandas to_dict('records') -> [{a:1}, {a:2}] */
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];

  /* Pandas split: { columns, index, data } */
  if (Array.isArray(data.columns) && Array.isArray(data.data)) {
    return data.data.map((row) => Object.fromEntries(data.columns.map((c, j) => [c, row[j]])));
  }

  /* Dict of columns: pandas to_dict('list') -> {a: [1,2], b: [3,4]}, or the same under `data` */
  const columns = data.data && typeof data.data === "object" && !Array.isArray(data.data) ? data.data : data;
  const names = Object.keys(columns);
  const length = names.length && Array.isArray(columns[names[0]]) ? columns[names[0]].length : 0;
  return Array.from({ length }, (_, i) => Object.fromEntries(names.map((c) => [c, columns[c] && columns[c][i]])));
}

/**
 * The grid for the endpoint's JSON and the widget's `data["ag-grid"]` object, an OpenBB table
 * configuration (columnsDefs, formatterFn, transpose, showAll, chartView, ...).
 * `columnsKey` changes when the columns must be set again.
 */
function normalizeData(data, definition) {
  const table = definition && typeof definition === "object" ? definition : {};

  /* Ag-grid-ready object: { columnDefs, rowData, gridOptions? } */
  if (data && typeof data === "object" && !Array.isArray(data) && Array.isArray(data.columnDefs)) {
    const rowData = Array.isArray(data.rowData) ? data.rowData : [];
    return {
      rowData,
      columnDefs: compactColumnDefs(data.columnDefs, rowData),
      gridOptions: data.gridOptions || {},
      table,
      transposed: false,
      columnsKey: JSON.stringify(data.columnDefs),
    };
  }

  const rows = data && typeof data === "object" && !Array.isArray(data) && Array.isArray(data.rowData) ? data.rowData : rowsOf(data);
  const gridOptions = data && typeof data === "object" && !Array.isArray(data) && data.gridOptions ? data.gridOptions : {};
  const columnDefs = agTableChartColumnDefs(rows, table);
  const columnsKey = JSON.stringify({ table, fields: fieldsOf(rows) });
  if (table.transpose === true) {
    return { ...transpose(rows, columnDefs), gridOptions, table, transposed: true, columnsKey: `${columnsKey}|${rows.length}` };
  }
  return { rowData: rows, columnDefs, gridOptions, table, transposed: false, columnsKey };
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

export { chartThemesFor, themeClass, rowIdOf, diffRows, cellChanges, inferType, inferColumnType, normalizeData, numericStats, compactColumnDefs };

let api = null;
let licensePromise = null;

/* --- Module-level state shared by initialize + render --- */
const gridState = {
  selection: [],
  lastEvent: null,
  rowCount: 0,
  columnCount: 0,
  filterModel: null,
  sortModel: null,
  columnState: null,
  chartView: null,
  agentPrompt: null,
};

const persistState = (model) => {
  try { model.set("state", { ...gridState }); model.save_changes(); }
  catch (e) { console.warn("ag-grid state write:", e.message); }
};

const recordEvent = (model, kind, detail) => {
  gridState.lastEvent = { kind, detail, timestamp: Date.now() };
  persistState(model);
};

function displayedRows(limit = 5000) {
  const rows = [];
  api?.forEachNodeAfterFilterAndSort((node) => {
    if (node.data && rows.length < limit) rows.push(node.data);
  });
  return rows;
}

function element(doc, className, style = {}) {
  const node = doc.createElement("div");
  node.className = className;
  Object.assign(node.style, style);
  return node;
}

export default {
  initialize({ model }) {
    const adminSettings = model.get("adminSettings") || {};
    const config = model.get("config") || {};
    const licenseKey = config.licenseKey || adminSettings.licenseKey || "";
    licensePromise = loadEnterprise(licenseKey);

    const saved = model.get("state");
    if (saved && typeof saved === "object" && saved.chartView) gridState.chartView = saved.chartView;

    const exportOptions = () => [{ id: "csv", label: "Rows (CSV)", extension: "csv", mime: "text/csv" }];

    const exportData = (id) => {
      if (id !== "csv" || !api) return null;
      try {
        return api.getDataAsCsv({
          processCellCallback: (p) => (p.value instanceof Date ? p.node?.data?.[p.column.getColDef().field] : Array.isArray(p.value) ? p.value.join(" ") : p.value),
        });
      } catch (e) { console.warn("ag-grid exportData:", e); return null; }
    };

    const copilotContext = () => {
      if (!api) return null;
      const rows = displayedRows();
      const columns = (api.getColumns?.() ?? []).map((c) => ({ field: c.getColDef().field, headerName: c.getColDef().headerName })).filter((c) => c.field);
      return {
        rowCount: rows.length,
        columnCount: columns.length,
        columns,
        selectionCount: gridState.selection.length,
        filterModel: gridState.filterModel,
        sortModel: gridState.sortModel,
        chartView: gridState.chartView ? { open: gridState.chartView.open } : null,
        lastAgentPrompt: gridState.agentPrompt,
        stats: numericStats(rows, columns.map((c) => c.field)),
        rows: rows.slice(0, 200),
      };
    };

    return { exportOptions, exportData, copilotContext };
  },

  async render({ model, el, signal, experimental }) {
    await licensePromise;

    el.replaceChildren();
    const doc = el.ownerDocument ?? document;

    const theme = model.get("theme") || {};
    let mode = theme?.mode ?? "light";

    const idFieldOf = (definition) => (definition && typeof definition.wsRowIdColumn === "string" ? definition.wsRowIdColumn : "id");
    const initial = normalizeData(model.get("data") || {}, model.get("definition") || {});
    const { rowData, columnDefs, gridOptions, table } = initial;
    let idField = idFieldOf(table);
    let currentRowData = rowData;
    let currentColumnsKey = initial.columnsKey;
    let currentGridOptions = gridOptions;
    let tracked = initial.transposed ? [] : changeTrackedColumns(table.columnsDefs);
    const flashTimers = new Set();

    const invoke = async (command, message) => {
      if (!experimental?.invoke) throw new Error("host commands are unavailable");
      return experimental.invoke(command, message);
    };
    const notify = (level, text) => invoke("core:ui:notify", { level, text }).catch(() => {});

    const actions = {
      groupBy(paramName, value, forceUpdate) {
        const params = model.get("params") || {};
        if (!Object.hasOwn(params, paramName)) {
          console.warn(`ag-grid cellOnClick: ${paramName} is not a param of this widget`);
          notify("warning", `${paramName} is not a parameter of this widget.`);
          return;
        }
        model.set("params", { ...params, [paramName]: value });
        model.save_changes();
        recordEvent(model, "cellOnClick", { actionType: "groupBy", paramName, value, forceUpdate });
      },
      openUrl(url) {
        if (!/^(https|mailto):/i.test(url)) {
          notify("warning", "Only https: and mailto: links can be opened.");
          return;
        }
        invoke("core:ui:open-link", { url }).catch((e) => console.warn("ag-grid openUrl:", e.message));
        recordEvent(model, "cellOnClick", { actionType: "openUrl", url });
      },
      sendToAgent(markdown, agentId) {
        gridState.agentPrompt = { markdown, agentId: agentId ?? null, timestamp: Date.now() };
        recordEvent(model, "cellOnClick", { actionType: "sendToAgent", agentId: agentId ?? null });
        invoke("core:clipboard:write", { text: markdown })
          .then(() => notify("info", "Prompt copied. Paste it into the AI agent."))
          .catch(() => notify("info", "The prompt is in the widget's context for the AI agent."));
      },
    };

    const context = { locale: theme.locale, decimals: theme.decimals, actions, changes: new Map() };

    const container = element(doc, "ag-grid-container", { height: "100%", width: "100%", display: "flex", flexDirection: "column" });
    el.appendChild(container);
    const body = element(doc, "ag-table-chart-body", { position: "relative", flex: "1 1 auto", minHeight: "0" });
    const gridEl = element(doc, themeClass(mode), { position: "absolute", inset: "0" });
    const chartEl = element(doc, `ag-table-chart-chart ${themeClass(mode)}`, { position: "absolute", inset: "0", visibility: "hidden" });
    body.append(gridEl, chartEl);

    const chartsAvailable = Boolean(agGridEnterprise);
    const chartsOn = chartsAvailable && table.enableCharts !== false;
    const wantsChartView = chartsOn && !initial.transposed && (table.enableCharts === true || Boolean(table.chartView));

    let toolbar = null;
    if (wantsChartView) {
      toolbar = element(doc, `ag-table-chart-toolbar ${themeClass(mode)}`);
      container.appendChild(toolbar);
    }
    container.appendChild(body);

    const enterpriseOptions = chartsAvailable
      ? {
          sideBar: table.enableAdvanced === false ? false : { toolPanels: ["columns", "filters"], defaultToolPanel: table.enableAdvanced === true ? "columns" : "" },
          rowGroupPanelShow: "onlyWhenGrouping",
          pivotPanelShow: "onlyWhenPivoting",
          suppressAggFuncInHeader: true,
          cellSelection: true,
          enableCharts: chartsOn,
          chartThemes: chartThemesFor(mode),
          popupParent: doc.body,
          statusBar: {
            statusPanels: [
              { statusPanel: "agTotalAndFilteredRowCountComponent", align: "left" },
              { statusPanel: "agAggregationComponent", align: "right" },
            ],
          },
        }
      : {};
    const hasIds = (rows) => rows.length > 0 && rows.every((r) => r && r[idField] !== undefined && r[idField] !== null);
    const useIds = !initial.transposed && hasIds(rowData);
    const mergedOptions = {
      pagination: rowData.length > 100,
      paginationAutoPageSize: true,
      paginationPageSizeSelector: false,
      suppressDragLeaveHidesColumns: true,
      stopEditingWhenCellsLoseFocus: true,
      tooltipShowDelay: 400,
      tooltipInteraction: true,
      ...enterpriseOptions,
      ...(useIds ? { getRowId: (params) => String(params.data[idField]) } : {}),
      columnDefs,
      rowData,
      ...gridOptions,
      context,
      animateRows: true,
      enableCellTextSelection: !chartsAvailable,
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
        ...(chartsAvailable ? { enableRowGroup: true, enablePivot: true, enableValue: true } : {}),
        ...(gridOptions.defaultColDef || {}),
      },
    };

    /* --- Grid events, recorded to the state trait --- */
    const onSelectionChanged = () => {
      const nodes = api.getSelectedNodes();
      gridState.selection = nodes.map((n) => ({ id: n.id, data: n.data }));
      gridState.rowCount = api.getDisplayedRowCount();
      recordEvent(model, "selectionChanged", { count: nodes.length });
    };
    const onCellValueChanged = (event) => {
      recordEvent(model, "cellValueChanged", {
        rowIndex: event.rowIndex,
        colDef: event.colDef?.field,
        oldValue: event.oldValue, newValue: event.newValue,
      });
    };
    const onRowDataUpdated = () => {
      gridState.rowCount = api.getDisplayedRowCount();
      gridState.columnCount = (api.getColumns?.() ?? []).length;
      recordEvent(model, "rowDataChanged", { rowCount: gridState.rowCount });
    };
    const onFilterChanged = () => {
      gridState.filterModel = api.getFilterModel();
      recordEvent(model, "filterChanged", { filterModel: gridState.filterModel });
    };
    const onSortChanged = () => {
      gridState.sortModel = api.getColumnState().filter((c) => c.sort).map((c) => ({ colId: c.colId, sort: c.sort, sortIndex: c.sortIndex }));
      recordEvent(model, "sortChanged", { sortModel: gridState.sortModel });
    };
    const onColumnChanged = (event) => {
      if (event.type === "columnResized" && !event.finished) return;
      gridState.columnState = api.getColumnState();
      recordEvent(model, event.type, { columnCount: gridState.columnState.length });
    };
    const onCellClicked = (event) => {
      const value = event.value;
      recordEvent(model, "cellClicked", {
        rowIndex: event.rowIndex,
        colDef: event.colDef?.field,
        value: value instanceof Date ? value.toISOString() : Array.isArray(value) ? null : value,
      });
    };
    const listeners = {
      selectionChanged: onSelectionChanged,
      cellValueChanged: onCellValueChanged,
      rowDataUpdated: onRowDataUpdated,
      filterChanged: onFilterChanged,
      sortChanged: onSortChanged,
      columnResized: onColumnChanged,
      columnMoved: onColumnChanged,
      cellClicked: onCellClicked,
    };

    api = agGridCommunity.createGrid(gridEl, mergedOptions);
    for (const [name, listener] of Object.entries(listeners)) api.addEventListener(name, listener);

    gridState.rowCount = api.getDisplayedRowCount();
    gridState.columnCount = columnDefs.length;
    persistState(model);

    /* --- ChartView: the table as a chart, switched from the toolbar --- */
    let chartView = null;
    if (wantsChartView && typeof api.createRangeChart === "function") {
      const buttons = {};
      const setPressed = () => {
        buttons.table.setAttribute("aria-pressed", String(!chartView.isOpen));
        buttons.chart.setAttribute("aria-pressed", String(chartView.isOpen));
      };
      for (const [key, label] of [["table", "Table"], ["chart", "Chart"]]) {
        const button = doc.createElement("button");
        button.type = "button";
        button.className = "ag-table-chart-toolbar-button";
        button.textContent = label;
        button.addEventListener("click", () => {
          if (key === "chart") chartView.open(); else chartView.close();
          setPressed();
        });
        buttons[key] = button;
        toolbar.appendChild(button);
      }
      chartView = createChartView({
        api,
        gridEl,
        chartEl,
        chartView: table.chartView ?? {},
        saved: gridState.chartView,
        mode,
        onChange: (value) => {
          gridState.chartView = value;
          persistState(model);
        },
      });
      setPressed();
    } else if (toolbar) {
      toolbar.remove();
    }

    const flash = (changes) => {
      if (!changes.size) return;
      for (const [key, direction] of changes) context.changes.set(key, direction);
      const columns = [...new Set(tracked.map((t) => t.field))];
      api.refreshCells({ columns, force: true });
      const timer = setTimeout(() => {
        flashTimers.delete(timer);
        for (const key of changes.keys()) if (context.changes.get(key) === changes.get(key)) context.changes.delete(key);
        api?.refreshCells({ columns, force: true });
      }, CHANGE_FLASH_MS);
      flashTimers.add(timer);
    };

    const applyStreamingUpdate = (next, transposed) => {
      const changes = transposed ? new Map() : cellChanges(currentRowData, next, tracked, idField);
      if (!transposed && api.getGridOption("getRowId") && hasIds(next)) {
        const { add, update, remove } = diffRows(currentRowData, next, idField);
        if (add.length || update.length || remove.length) {
          try { api.applyTransaction({ add, update, remove }); }
          catch (e) { console.warn("ag-grid applyTransaction:", e.message); api.setGridOption("rowData", next); }
        }
      } else if (JSON.stringify(currentRowData) !== JSON.stringify(next)) {
        api.setGridOption("rowData", next);
      }
      currentRowData = next;
      flash(changes);
    };

    const onDataChange = () => {
      const definition = model.get("definition") || {};
      const next = normalizeData(model.get("data") || {}, definition);
      idField = idFieldOf(next.table);
      tracked = next.transposed ? [] : changeTrackedColumns(next.table.columnsDefs);
      if (next.columnsKey !== currentColumnsKey) {
        currentColumnsKey = next.columnsKey;
        api.setGridOption("columnDefs", next.columnDefs);
      }
      if (JSON.stringify(next.gridOptions) !== JSON.stringify(currentGridOptions)) {
        currentGridOptions = next.gridOptions;
        Object.entries(next.gridOptions).forEach(([k, v]) => { try { api.setGridOption(k, v); } catch { /* not settable */ } });
      }
      applyStreamingUpdate(next.rowData, next.transposed);
    };

    const onThemeChange = () => {
      const nextTheme = model.get("theme") || {};
      mode = nextTheme?.mode ?? "light";
      for (const node of [gridEl, chartEl, toolbar].filter(Boolean)) {
        node.classList.remove(THEME_LIGHT, THEME_DARK);
        node.classList.add(themeClass(mode));
      }
      context.locale = nextTheme.locale;
      context.decimals = nextTheme.decimals;
      if (chartsAvailable) api.setGridOption("chartThemes", chartThemesFor(mode));
      api.refreshCells({ force: true });
      chartView?.setMode(mode);
    };

    model.on("change:data", onDataChange);
    model.on("change:definition", onDataChange);
    model.on("change:theme", onThemeChange);

    signal.addEventListener("abort", () => {
      model.off("change:data", onDataChange);
      model.off("change:definition", onDataChange);
      model.off("change:theme", onThemeChange);
      for (const timer of flashTimers) clearTimeout(timer);
      flashTimers.clear();
      for (const [name, listener] of Object.entries(listeners)) api.removeEventListener(name, listener);
      chartView?.destroy();
      api.destroy();
      api = null;
    });
  },
};
