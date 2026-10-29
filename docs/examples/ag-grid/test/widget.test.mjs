import assert from "node:assert/strict";
import { test } from "node:test";

// Minimal stubs so entry.js can load in Node without a browser.
// AgGrid itself needs a DOM, so these tests cover the pure helper logic
// (diffRows, numericStats) and the export/copilot shapes rather than rendering.

globalThis.document = {
  createElement: () => ({
    classList: { add: () => {}, remove: () => {} },
    style: {},
    appendChild: () => {},
    replaceChildren: () => {},
  }),
  querySelector: () => null,
};
globalThis.window = globalThis;
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
};

const { default: widget, themeClass, rowIdOf, diffRows, inferType, inferColumnType, normalizeData, numericStats, compactColumnDefs, chartThemesFor } = await import("../src/entry.js");

test("themeClass returns quartz theme names", () => {
  assert.equal(themeClass("light"), "ag-theme-quartz");
  assert.equal(themeClass("dark"), "ag-theme-quartz-dark");
  assert.equal(themeClass("light"), "ag-theme-quartz");
});

test("rowIdOf uses row.id when present", () => {
  assert.equal(rowIdOf({ id: "abc" }, 0), "abc");
  assert.equal(rowIdOf({}, 5), "5");
  assert.equal(rowIdOf(null, 2), "2");
});

test("diffRows detects adds, updates, and removes", () => {
  const oldRows = [
    { id: "1", name: "Alice", score: 10 },
    { id: "2", name: "Bob", score: 20 },
  ];
  const newRows = [
    { id: "2", name: "Bob", score: 21 }, // updated
    { id: "3", name: "Carol", score: 30 }, // added
  ];
  const { add, update, remove } = diffRows(oldRows, newRows);
  assert.equal(add.length, 1);
  assert.equal(add[0].id, "3");
  assert.equal(update.length, 1);
  assert.equal(update[0].id, "2");
  assert.equal(update[0].score, 21);
  assert.equal(remove.length, 1);
  assert.equal(remove[0].id, "1");
});

test("diffRows with no changes returns empty", () => {
  const rows = [{ id: "1", name: "Alice" }];
  const { add, update, remove } = diffRows(rows, rows);
  assert.equal(add.length, 0);
  assert.equal(update.length, 0);
  assert.equal(remove.length, 0);
});

test("numericStats computes min/max/sum/avg for numeric columns", () => {
  const rows = [
    { name: "Alice", score: 10 },
    { name: "Bob", score: 20 },
    { name: "Carol", score: 30 },
  ];
  const stats = numericStats(rows, ["score", "name"]);
  assert.deepEqual(stats.score, { count: 3, min: 10, max: 30, sum: 60, avg: 20 });
  assert.equal(stats.name, undefined); // non-numeric column is skipped
});

test("numericStats ignores null and NaN", () => {
  const rows = [
    { score: 10 },
    { score: null },
    { score: NaN },
    { score: 30 },
  ];
  const stats = numericStats(rows, ["score"]);
  assert.deepEqual(stats.score, { count: 2, min: 10, max: 30, sum: 40, avg: 20 });
});

test("widget default export has initialize and render", () => {
  assert.equal(typeof widget.initialize, "function");
  assert.equal(typeof widget.render, "function");

test("inferType detects booleans, numbers, dates, strings", () => {
  assert.equal(inferType(true), "boolean");
  assert.equal(inferType(42), "numeric");
  assert.equal(inferType("2024-01-15"), "date");
  assert.equal(inferType("hello"), "string");
  assert.equal(inferType(null), "empty");
  assert.equal(inferType(undefined), "empty");
});

test("inferColumnType picks dominant type", () => {
  assert.equal(inferColumnType([1, 2, 3]), "numeric");
  assert.equal(inferColumnType(["a", "b", "c"]), "string");
  assert.equal(inferColumnType(["2024-01-01", "2024-02-01"]), "date");
  assert.equal(inferColumnType([true, false, true]), "boolean");
  assert.equal(inferColumnType([null, null, null]), "string");
});

test("normalizeData handles list of records", () => {
  const { rowData, columnDefs, config } = normalizeData([
    { region: "EMEA", sales: 100 },
    { region: "APAC", sales: 200 },
  ]);
  assert.equal(rowData.length, 2);
  assert.equal(columnDefs.length, 2);
  assert.equal(columnDefs[0].field, "region");
  assert.equal(columnDefs[1].field, "sales");
  assert.equal(columnDefs[1].filter, "agNumberColumnFilter");
  assert.deepEqual(config.groupBy, []);
});

test("normalizeData handles dict of columns (pandas to_dict list)", () => {
  const { rowData, columnDefs } = normalizeData({
    region: ["EMEA", "APAC"],
    sales: [100, 200],
  });
  assert.equal(rowData.length, 2);
  assert.equal(rowData[0].region, "EMEA");
  assert.equal(rowData[0].sales, 100);
  assert.equal(rowData[1].region, "APAC");
  assert.equal(rowData[1].sales, 200);
  assert.equal(columnDefs.length, 2);
});

test("normalizeData handles pandas split format", () => {
  const { rowData, columnDefs } = normalizeData({
    columns: ["region", "sales"],
    index: [0, 1],
    data: [["EMEA", 100], ["APAC", 200]],
  });
  assert.equal(rowData.length, 2);
  assert.equal(rowData[0].region, "EMEA");
  assert.equal(rowData[0].sales, 100);
  assert.equal(columnDefs.length, 2);
});

test("normalizeData applies groupBy from definition", () => {
  const { columnDefs, config } = normalizeData(
    [{ region: "EMEA", sales: 100 }, { region: "APAC", sales: 200 }],
    { groupBy: ["region"], rowSpan: ["region"] }
  );
  assert.deepEqual(config.groupBy, ["region"]);
  assert.deepEqual(config.rowSpan, ["region"]);
  const regionDef = columnDefs.find((c) => c.field === "region");
  assert.equal(regionDef.rowGroup, true);
  assert.equal(regionDef.hide, true);
});

test("normalizeData passes through ag-grid ready objects", () => {
  const input = {
    columnDefs: [{ field: "x", headerName: "X" }],
    rowData: [{ x: 1 }],
    gridOptions: { pagination: true },
  };
  const { rowData, columnDefs } = normalizeData(input);
  assert.equal(rowData.length, 1);
  assert.equal(columnDefs.length, 1);
  assert.equal(columnDefs[0].field, "x");
});
});
test("compactColumnDefs formats numeric columns and leaves the rest alone", () => {
  const rows = [{ name: "a", units: 1234567, note: null }];
  const defs = [
    { field: "name" },
    { field: "units" },
    { field: "note" },
    { field: "fixed", type: "rightAligned" },
    { headerName: "Group", children: [{ field: "units" }] },
  ];
  const out = compactColumnDefs(defs, rows);
  assert.equal(out[0].type, undefined);
  assert.equal(out[1].type, "numericColumn");
  assert.equal(out[1].valueFormatter({ value: 1234567 }), new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(1234567));
  assert.equal(out[1].valueFormatter({ value: "x" }), "x");
  assert.equal(out[2].type, undefined);
  assert.equal(out[3].type, "rightAligned");
  assert.equal(out[4].children[0].type, "numericColumn");
});

test("chart themes follow the site's mode", () => {
  assert.deepEqual(chartThemesFor("light").slice(0, 2), ["ag-default", "ag-vivid"]);
  assert.ok(chartThemesFor("dark").every((name) => name.endsWith("-dark")));
  assert.equal(chartThemesFor("dark").length, chartThemesFor("light").length);
});
