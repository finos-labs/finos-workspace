import assert from "node:assert/strict";
import { test } from "node:test";

import "./dom.mjs";
import { chartThemesFor, compactColumnDefs, diffRows, gridOptionsFor, inferColumnType, inferType, normalizeData, numericStats, rowIdOf, themeClass } from "../src/grid.js";

test("themeClass returns quartz theme names", () => {
  assert.equal(themeClass("light"), "ag-theme-quartz");
  assert.equal(themeClass("dark"), "ag-theme-quartz-dark");
});

test("rowIdOf uses row.id when present", () => {
  assert.equal(rowIdOf({ id: "abc" }, 0), "abc");
  assert.equal(rowIdOf({}, 5), "5");
  assert.equal(rowIdOf(null, 2), "2");
});

test("diffRows detects adds, updates, and removes", () => {
  const { add, update, remove } = diffRows(
    [{ id: "1", score: 10 }, { id: "2", score: 20 }],
    [{ id: "2", score: 21 }, { id: "3", score: 30 }],
  );
  assert.deepEqual(add.map((r) => r.id), ["3"]);
  assert.deepEqual(update.map((r) => r.score), [21]);
  assert.deepEqual(remove.map((r) => r.id), ["1"]);
  const rows = [{ id: "1" }];
  const same = diffRows(rows, rows);
  assert.equal(same.add.length + same.update.length + same.remove.length, 0);
});

test("numericStats computes min/max/sum/avg and ignores null and NaN", () => {
  const stats = numericStats([{ s: 10, n: "a" }, { s: null }, { s: NaN }, { s: 30 }], ["s", "n"]);
  assert.deepEqual(stats.s, { count: 2, min: 10, max: 30, sum: 40, avg: 20 });
  assert.equal(stats.n, undefined);
});

test("numericStats handles a million rows", () => {
  const rows = Array.from({ length: 1_000_000 }, (_, i) => ({ v: i }));
  assert.deepEqual(numericStats(rows, ["v"]).v, { count: 1_000_000, min: 0, max: 999_999, sum: 499_999_500_000, avg: 499_999.5 });
});

test("types are inferred from values", () => {
  assert.equal(inferType(true), "boolean");
  assert.equal(inferType(42), "numeric");
  assert.equal(inferType("2024-01-15"), "date");
  assert.equal(inferType("hello"), "string");
  assert.equal(inferType(null), "empty");
  assert.equal(inferColumnType([1, 2, 3]), "numeric");
  assert.equal(inferColumnType(["2024-01-01", "2024-02-01"]), "date");
  assert.equal(inferColumnType([null, null]), "string");
});

test("normalizeData reads records, columns, the split format and ag-grid objects", () => {
  const records = normalizeData([{ region: "EMEA", sales: 100 }, { region: "APAC", sales: 200 }]);
  assert.deepEqual(records.columnDefs.map((c) => c.field), ["region", "sales"]);
  assert.equal(records.columnDefs[1].filter, "agNumberColumnFilter");
  const columns = normalizeData({ region: ["EMEA", "APAC"], sales: [100, 200] });
  assert.deepEqual(columns.rowData, records.rowData);
  const split = normalizeData({ columns: ["region", "sales"], index: [0, 1], data: [["EMEA", 100], ["APAC", 200]] });
  assert.deepEqual(split.rowData, records.rowData);
  const ready = normalizeData({
    columnDefs: [{ field: "region", rowGroup: true, hide: true }, { field: "x" }],
    rowData: [{ region: "EMEA", x: 1 }],
    gridOptions: { pagination: true },
  });
  assert.equal(ready.columnDefs[0].rowGroup, true);
  assert.equal(ready.columnDefs[1].type, "numericColumn");
  assert.deepEqual(ready.gridOptions, { pagination: true });
  assert.deepEqual(normalizeData(null), { rowData: [], columnDefs: [], gridOptions: {} });
});

test("compactColumnDefs formats numeric columns and leaves the rest alone", () => {
  const out = compactColumnDefs(
    [{ field: "name" }, { field: "units" }, { field: "note" }, { field: "fixed", type: "rightAligned" }, { headerName: "Group", children: [{ field: "units" }] }],
    [{ name: "a", units: 1234567, note: null }],
  );
  assert.equal(out[0].type, undefined);
  assert.equal(out[1].type, "numericColumn");
  assert.equal(out[1].valueFormatter({ value: 1234567 }), new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(1234567));
  assert.equal(out[1].valueFormatter({ value: "x" }), "x");
  assert.equal(out[2].type, undefined);
  assert.equal(out[3].type, "rightAligned");
  const animated = compactColumnDefs([{ field: "price", type: "numericColumn", cellRenderer: "agAnimateShowChangeCellRenderer" }], []);
  assert.equal(animated[0].valueFormatter({ value: 0.6700000000000017 }), "0.67");
  assert.equal(animated[0].cellRenderer, "agAnimateShowChangeCellRenderer");
  assert.equal(out[4].children[0].type, "numericColumn");
});

test("chart themes follow the site's mode", () => {
  assert.deepEqual(chartThemesFor("light").slice(0, 2), ["ag-default", "ag-vivid"]);
  assert.ok(chartThemesFor("dark").every((name) => name.endsWith("-dark")));
});

test("the row group, pivot and tool panels are on for every grid, whatever a backend sends", () => {
  const options = gridOptionsFor({
    mode: "light",
    rowData: [],
    columnDefs: [],
    gridOptions: { rowGroupPanelShow: "never", pivotPanelShow: "never", sideBar: false, enableCharts: false, defaultColDef: { editable: true } },
  });
  assert.equal(options.rowGroupPanelShow, "always");
  assert.equal(options.pivotPanelShow, "always");
  assert.deepEqual(options.sideBar.toolPanels, ["columns", "filters"]);
  assert.equal(options.enableCharts, true);
  assert.equal(options.cellSelection, true);
  assert.equal(options.defaultColDef.enableRowGroup, true);
  assert.equal(options.defaultColDef.enablePivot, true);
  assert.equal(options.defaultColDef.enableValue, true);
  assert.equal(options.defaultColDef.editable, true);
});
