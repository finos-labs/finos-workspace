import { createWidget, isNumeric } from "../../sql-explorer/src/widget.js";
import { createGrid, formatNumber, gridOptionsFor, licenseKeyOf, loadEnterprise, setTheme, themeClass } from "./grid.js";

export function formatCell(params) {
  const { value } = params;
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return formatNumber(params);
}

export function gridColumns(result) {
  const first = result.rows[0] ?? [];
  return result.columns.map((column, i) => ({
    field: String(i),
    headerName: column.name,
    headerTooltip: column.type,
    valueFormatter: formatCell,
    ...(isNumeric(column, first[i]) ? { type: "numericColumn" } : {}),
  }));
}

export function gridRows(result) {
  return result.rows.map((row) => Object.fromEntries(row.map((value, i) => [String(i), value])));
}

let ready = Promise.resolve();

async function showGrid(host, result, mode) {
  await ready;
  host.classList.add(themeClass(mode));
  const api = createGrid(
    host,
    gridOptionsFor({ mode, rowData: gridRows(result), columnDefs: gridColumns(result) }),
  );
  return {
    setMode: (next) => setTheme(host, api, next),
    destroy: () => api.destroy(),
  };
}

const widget = createWidget({ showGrid });

export default {
  initialize({ model }) {
    ready = loadEnterprise(licenseKeyOf(model));
    return widget.initialize();
  },
  render: widget.render,
};
