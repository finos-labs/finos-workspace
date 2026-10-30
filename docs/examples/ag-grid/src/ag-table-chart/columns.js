/*
 * OpenBB's table configuration (`data.table` in an OpenBB widgets.json, `data["ag-grid"]` here)
 * as AG Grid column definitions. Formatting, styles and clicks read `params.context`, which the
 * grid shares: { locale, decimals, actions, changes }.
 */
import { fieldsOf, inferColumnType } from "../infer.js";
import { columnColorStyle, greenRedStyle } from "./colors.js";
import { formatValue, headerFromField, titleCase, yearOf } from "./format.js";
import { fillTemplate, renderMarkdown } from "./markdown.js";
import { sparklineData, sparklineOptions } from "./sparkline.js";

export const RENDER_FNS = ["greenRed", "titleCase", "hoverCard", "cellOnClick", "columnColor", "showCellChange"];

export function renderFnsOf(def) {
  const fns = Array.isArray(def?.renderFn) ? def.renderFn : def?.renderFn ? [def.renderFn] : [];
  return fns.filter((fn) => RENDER_FNS.includes(fn));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
}

/** The value a cell shows of an object value: the hover card's `cellField`, else `value`. */
function cellValueOf(raw, cellField) {
  if (!isPlainObject(raw)) return raw;
  if (cellField && Object.hasOwn(raw, cellField)) return raw[cellField];
  if (Object.hasOwn(raw, "value")) return raw.value;
  return JSON.stringify(raw);
}

function toDate(value) {
  if (value instanceof Date || value === null || value === undefined || value === "") return value ?? null;
  const parsed = new Date(typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
  return Number.isNaN(parsed.getTime()) ? value : parsed;
}

function dateComparator(filterDate, cellValue) {
  const cell = toDate(cellValue);
  if (!(cell instanceof Date)) return -1;
  const day = new Date(cell.getFullYear(), cell.getMonth(), cell.getDate()).getTime();
  return day === filterDate.getTime() ? 0 : day < filterDate.getTime() ? -1 : 1;
}

/** The OpenBB data type of a column: its `cellDataType`, else inferred from the rows. */
function dataTypeOf(def, rows) {
  if (def.cellDataType) return def.cellDataType;
  const values = rows.slice(0, 200).map((r) => (r ? r[def.field] : undefined));
  const inferred = inferColumnType(values);
  return { numeric: "number", date: "date", boolean: "boolean", string: "text", object: "object", array: "object" }[inferred] ?? "text";
}

/** A tooltip component (AG Grid ITooltipComp) that shows OpenBB's hover card. */
export class HoverCardTooltip {
  init(params) {
    const doc = params.eGridCell?.ownerDocument ?? document;
    const config = params.hoverCard ?? {};
    const raw = params.data ? params.data[params.colDef?.field] : undefined;
    const cellObject = isPlainObject(raw) ? raw : {};
    const gui = doc.createElement("div");
    gui.className = "ag-table-chart-hover-card";
    if (config.title) {
      const title = doc.createElement("div");
      title.className = "ag-table-chart-hover-card-title";
      title.textContent = fillTemplate(config.title, cellObject, params.data);
      gui.appendChild(title);
    }
    if (config.markdown) {
      gui.appendChild(renderMarkdown(doc, fillTemplate(config.markdown, cellObject, params.data)));
    } else {
      const fields = Array.isArray(params.hoverCardData) && params.hoverCardData.length
        ? params.hoverCardData
        : Object.keys(cellObject);
      const list = doc.createElement("dl");
      for (const field of fields) {
        const value = Object.hasOwn(cellObject, field) ? cellObject[field] : params.data?.[field];
        if (value === undefined) continue;
        const dt = doc.createElement("dt");
        dt.textContent = headerFromField(field);
        const dd = doc.createElement("dd");
        dd.textContent = isPlainObject(value) || Array.isArray(value) ? JSON.stringify(value) : String(value);
        list.append(dt, dd);
      }
      gui.appendChild(list);
    }
    this.gui = gui;
  }

  getGui() {
    return this.gui;
  }
}

function clickValue(def, params) {
  const fieldValue = def.renderFnParams?.groupBy?.valueField;
  if (fieldValue && params.data && Object.hasOwn(params.data, fieldValue)) return cellValueOf(params.data[fieldValue]);
  return params.value instanceof Date ? params.data?.[def.field] : params.value;
}

function onCellClick(def, params) {
  const p = def.renderFnParams ?? {};
  const actions = params.context?.actions;
  if (!actions) return;
  const row = params.data ?? {};
  switch (p.actionType) {
    case "groupBy":
      if (p.groupBy?.paramName) actions.groupBy(p.groupBy.paramName, clickValue(def, params), p.groupBy.forceUpdate === true);
      break;
    case "sendToAgent":
      actions.sendToAgent(fillTemplate(p.sendToAgent?.markdown ?? `{${def.field}}`, row), p.sendToAgent?.agentId);
      break;
    case "openUrl":
      actions.openUrl(p.url ? fillTemplate(p.url, row) : String(clickValue(def, params) ?? ""));
      break;
    default:
      break;
  }
}

/** One OpenBB column definition as an AG Grid ColDef. */
export function toColDef(def, rows, table = {}) {
  const field = def.field;
  const fns = renderFnsOf(def);
  const p = def.renderFnParams ?? {};
  const type = dataTypeOf(def, rows);
  const formatterFn = def.formatterFn ?? table.formatterFn;
  const isDate = type === "date" || type === "dateString" || def.chartDataType === "time";
  const hoverCard = fns.includes("hoverCard");
  const cellField = p.hoverCard?.cellField;

  const col = {
    field,
    colId: field,
    headerName: def.headerName ?? headerFromField(field),
    cellDataType: false,
  };
  for (const key of ["headerTooltip", "width", "minWidth", "maxWidth", "hide", "pinned", "chartDataType"]) {
    if (def[key] !== undefined) col[key] = def[key];
  }
  if (typeof def.width === "number") col.flex = 0;

  if (def.sparkline) {
    const dataField = def.sparkline.dataField;
    col.valueGetter = (params) => sparklineData(params.data ? params.data[dataField ?? field] : undefined);
    col.cellRenderer = "agSparklineCellRenderer";
    col.cellRendererParams = { sparklineOptions: sparklineOptions(def.sparkline) };
    col.sortable = false;
    col.filter = false;
    col.chartDataType = "excluded";
    return col;
  }

  if (isDate) {
    col.valueGetter = (params) => toDate(params.data ? cellValueOf(params.data[field], cellField) : undefined);
    col.filter = "agDateColumnFilter";
    col.filterParams = { comparator: dateComparator };
  } else if (type === "object" || hoverCard) {
    col.valueGetter = (params) => cellValueOf(params.data ? params.data[field] : undefined, cellField);
  }
  if (type === "number") {
    col.filter = "agNumberColumnFilter";
    col.type = "numericColumn";
  } else if (!isDate) {
    col.filter = "agTextColumnFilter";
  }

  col.valueFormatter = (params) => {
    let value = params.value;
    if (value instanceof Date) {
      if (formatterFn === "dateToYear") return yearOf(value) ?? "";
      const original = params.data ? cellValueOf(params.data[field], cellField) : value;
      value = original instanceof Date ? original.toISOString().slice(0, 10) : original;
      return formatValue(value, { prefix: def.prefix, suffix: def.suffix });
    }
    if (typeof value === "boolean") value = String(value);
    if (Array.isArray(value)) value = value.join(", ");
    let text = formatValue(value, {
      formatterFn,
      decimalPlaces: def.decimalPlaces,
      prefix: def.prefix,
      suffix: def.suffix,
      locale: params.context?.locale,
      decimals: params.context?.decimals,
    });
    if (fns.includes("titleCase")) text = titleCase(text);
    return text;
  };

  const align = def.align;
  if (align) {
    col.headerClass = `ag-table-chart-header-${align}`;
    col.type = undefined;
  }
  const colorField = p.colorValueKey;
  const colors = fns.includes("columnColor") || fns.includes("greenRed");
  if (align || colors) {
    col.cellStyle = (params) => {
      const style = { color: null, backgroundColor: null };
      if (align) style.textAlign = align;
      const value = colorField && params.data ? cellValueOf(params.data[colorField]) : params.value;
      let color = null;
      if (fns.includes("columnColor")) color = Array.isArray(p.colorRules) && p.colorRules.length ? columnColorStyle(p.colorRules, value) : greenRedStyle(value);
      if (!color && fns.includes("greenRed")) color = greenRedStyle(value);
      return { ...style, ...(color ?? {}) };
    };
  }

  const classRules = {};
  if (fns.includes("cellOnClick")) {
    col.onCellClicked = (params) => onCellClick(def, params);
    classRules["ag-table-chart-clickable"] = () => true;
  }
  if (fns.includes("showCellChange") && def.enableCellChangeWs !== false) {
    classRules["ag-table-chart-cell-up"] = (params) => params.context?.changes?.get(`${params.node?.id}|${field}`) === "up";
    classRules["ag-table-chart-cell-down"] = (params) => params.context?.changes?.get(`${params.node?.id}|${field}`) === "down";
  }
  if (Object.keys(classRules).length) col.cellClassRules = classRules;

  if (hoverCard || (Array.isArray(p.hoverCardData) && p.hoverCardData.length)) {
    col.tooltipValueGetter = () => "hover card";
    col.tooltipComponent = HoverCardTooltip;
    col.tooltipComponentParams = { hoverCard: p.hoverCard ?? {}, hoverCardData: p.hoverCardData };
  }
  return col;
}

/** The columns whose changes flash, and the field whose change decides the colour. */
export function changeTrackedColumns(columnsDefs) {
  return (Array.isArray(columnsDefs) ? columnsDefs : [])
    .filter((def) => renderFnsOf(def).includes("showCellChange") && def.enableCellChangeWs !== false)
    .map((def) => ({ field: def.field, compareField: def.renderFnParams?.colorValueKey ?? def.field }));
}

/**
 * The AG Grid column definitions for rows and an OpenBB table configuration. With `showAll`
 * (the default), fields the rows have and `columnsDefs` does not are shown too.
 */
export function agTableChartColumnDefs(rows, table = {}) {
  const defs = Array.isArray(table.columnsDefs) ? table.columnsDefs.filter((d) => d && d.field) : [];
  const declared = new Set(defs.map((d) => d.field));
  const extra = table.showAll === false && defs.length ? [] : fieldsOf(rows).filter((f) => !declared.has(f));
  return [...defs, ...extra.map((field) => ({ field }))].map((def) => toColDef(def, rows, table));
}

/**
 * Swaps rows and columns: one row per column, one column per row, headed by the row's first
 * column. Each cell keeps the formatting and styles of the column it came from.
 */
export function transpose(rows, colDefs) {
  const visible = colDefs.filter((c) => !c.hide);
  if (!visible.length) return { rowData: [], columnDefs: [] };
  const [head, ...rest] = visible;
  const headerOf = (row, i) => {
    const value = head.valueGetter ? head.valueGetter({ data: row }) : row?.[head.field];
    const text = head.valueFormatter ? head.valueFormatter({ value, data: row, context: {} }) : value;
    return text === "" || text === null || text === undefined ? `Row ${i + 1}` : String(text);
  };
  const columnDefs = [
    { field: "__field", colId: "__field", headerName: head.headerName ?? "", pinned: "left", cellDataType: false, chartDataType: "category" },
    ...rows.map((row, i) => ({
      colId: `__r${i}`,
      headerName: headerOf(row, i),
      cellDataType: false,
      valueGetter: (params) => {
        const source = rest[params.data?.__col];
        return source?.valueGetter ? source.valueGetter({ ...params, data: row }) : row?.[source?.field];
      },
      valueFormatter: (params) => {
        const source = rest[params.data?.__col];
        return source?.valueFormatter ? source.valueFormatter({ ...params, data: row }) : params.value;
      },
      cellStyle: (params) => {
        const source = rest[params.data?.__col];
        return typeof source?.cellStyle === "function" ? source.cellStyle({ ...params, data: row }) : null;
      },
    })),
  ];
  const rowData = rest.map((col, i) => ({ __field: col.headerName ?? col.field, __col: i }));
  return { rowData, columnDefs };
}
