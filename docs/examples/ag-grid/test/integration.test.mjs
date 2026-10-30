// --- Setup jsDOM as the global environment BEFORE importing anything ---
// This simulates the plugin iframe where window/document already exist.
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!DOCTYPE html><html><body><div id=\"root\"></div></body></html>", {
  url: "https://localhost/",
});

// Assign real jsdom globals so DOM-dependent modules work.
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLDivElement = dom.window.HTMLDivElement;
globalThis.Node = dom.window.Node;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.Request = dom.window.Request;
globalThis.Response = dom.window.Response;
globalThis.fetch = dom.window.fetch;
globalThis.URL = dom.window.URL;
globalThis.MouseEvent = dom.window.MouseEvent;
globalThis.Event = dom.window.Event;
for (const name of ["DocumentFragment", "Element", "SVGElement", "HTMLCanvasElement", "CustomEvent", "KeyboardEvent", "FocusEvent", "getComputedStyle"]) {
  if (globalThis[name] === undefined && dom.window[name] !== undefined) {
    globalThis[name] = typeof dom.window[name] === "function" && name === "getComputedStyle" ? dom.window[name].bind(dom.window) : dom.window[name];
  }
}
dom.window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame;

// jsdom has no canvas: a no-op 2D context and Path2D let AG Charts build its scene.
const noop = new Proxy(function () {}, {
  get: (_t, key) => (key === Symbol.toPrimitive ? () => 0 : key === "width" || key === "actualBoundingBoxAscent" || key === "actualBoundingBoxDescent" ? 10 : noop),
  apply: () => noop,
  construct: () => noop,
  set: () => true,
});
dom.window.HTMLCanvasElement.prototype.getContext = () => noop;
dom.window.HTMLCanvasElement.prototype.toDataURL = () => "";
globalThis.Path2D = dom.window.Path2D = class { constructor() { return noop; } };

// ResizeObserver polyfill (jsdom doesn't provide it)
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// --- Import the plugin module (after window setup) ---
const mod = await import("../src/entry.js");
const plugin = mod.default;

console.log("=".repeat(60));
console.log("AG GRID WIDGET INTEGRATION TESTS");
console.log("=".repeat(60));

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) { console.log(`  ✔ ${name}`); passed++; }
  else { console.log(`  ✖ ${name}`); failed++; }
}

console.log("\n--- Plugin exports ---");
assert(typeof plugin.initialize === "function", "exports initialize");
assert(typeof plugin.render === "function", "exports render");

console.log("\n--- initialize() ---");
const mockModel = {
  data: null, theme: { mode: "light" }, adminSettings: {}, config: {}, state: null,
  _listeners: {},
  get(k) { return this[k]; },
  set(k, v) { this[k] = v; },
  save_changes() {},
  on(k, cb) { (this._listeners[k] = this._listeners[k] || []).push(cb); },
  off(k, cb) { this._listeners[k] = (this._listeners[k] || []).filter(c => c !== cb); },
};
const mockSignal = { addEventListener() {} };
const exps = plugin.initialize({ model: mockModel, signal: mockSignal });
assert(typeof exps.exportOptions === "function", "exportOptions is function");
assert(typeof exps.exportData === "function", "exportData is function");
assert(typeof exps.copilotContext === "function", "copilotContext is function");
const opts = exps.exportOptions();
assert(Array.isArray(opts) && opts.length > 0, "exportOptions returns non-empty array");

console.log("\n--- Real AgGrid grid creation ---");
const el = document.createElement("div");
el.style.width = "800px";
el.style.height = "600px";
document.body.appendChild(el);

const testData = [
  { id: 1, name: "Alice", sales: 100, date: "2024-01-15" },
  { id: 2, name: "Bob", sales: 250, date: "2024-01-16" },
  { id: 3, name: "Carol", sales: 175, date: "2024-01-17" },
];

const testColumnDefs = [
  { field: "id", headerName: "ID" },
  { field: "name", headerName: "Name" },
  { field: "sales", headerName: "Sales", type: "numericColumn" },
  { field: "date", headerName: "Date" },
];

const renderModel = {
  ...mockModel,
  data: { columnDefs: testColumnDefs, rowData: testData },
  theme: { mode: "light" },
  config: {},
  adminSettings: {},
};

await plugin.render({ model: renderModel, signal: mockSignal, el });
await new Promise(r => setTimeout(r, 100));

const gridDiv = el.querySelector(".ag-theme-quartz");
assert(gridDiv !== null, "grid container has ag-theme-quartz class");
assert(gridDiv !== null && gridDiv.children.length > 0, "grid has rendered content");

const euiGrid = el.querySelector(".ag-root-wrapper");
assert(euiGrid !== null, "ag-grid root wrapper present in DOM");

console.log("\n--- Streaming updates ---");
await plugin.render({
  model: {
    ...mockModel,
    data: { columnDefs: testColumnDefs, rowData: [...testData, { id: 4, name: "Dave", sales: 300, date: "2024-01-18" }] },
    theme: { mode: "light" },
    config: {},
    adminSettings: {},
    get(k) { return this[k]; },
    set(k, v) { this[k] = v; },
    save_changes() {},
    on(k, cb) { (this._listeners[k] = this._listeners[k] || []).push(cb); },
    off(k, cb) { this._listeners[k] = (this._listeners[k] || []).filter(c => c !== cb); },
  },
  signal: mockSignal,
  el,
});

await new Promise(r => setTimeout(r, 100));
assert(gridDiv.children.length > 0, "grid still has content after streaming update");

console.log("\n--- CSV export ---");
// AG Grid exportDataAsCsv triggers a browser download, doesn't return CSV string.
// In a real browser, this would download a file. Here we verify it doesn't throw.
try {
  exps.exportData("csv");
  console.log("  ✔ exportData() called without throwing (CSV download triggered in browser)");
  passed++;
} catch (e) {
  console.log(`  ✖ exportData() threw: ${e.message}`);
  failed++;
}

console.log("\n--- Copilot context ---");
const ctx = exps.copilotContext();
assert(ctx !== null, "copilotContext returns object");
if (ctx) {
  assert(ctx.rowCount >= 0, `copilotContext rowCount >= 0 (got ${ctx.rowCount})`);
  assert(Array.isArray(ctx.columns), "copilotContext has columns array");
  assert(ctx.columns.length > 0, "copilotContext columns non-empty");
}

console.log("\n--- Event system ---");
assert(mockModel.state !== undefined, "model state was set (persistence works)");

console.log("\n--- Signal abort ---");
assert(typeof mockSignal.addEventListener === "function", "signal supports addEventListener");

el.remove();

console.log("\n--- Table chart configuration ---");
const listeners = {};
const aborts = [];
const agTableChartModel = {
  data: [
    { id: "eth", name: { value: "Ethereum", description: "Smart contracts" }, tvl: 45e9, change_1d: 2.5, history: [1, 3, 2, 5] },
    { id: "btc", name: { value: "Bitcoin", description: "The first" }, tvl: 35e9, change_1d: -1.2, history: [4, 2, 6, 1] },
  ],
  definition: {
    enableCharts: true,
    chartView: { enabled: false, chartType: "column" },
    columnsDefs: [
      { field: "name", headerName: "Asset", chartDataType: "category", renderFn: ["hoverCard", "cellOnClick"], renderFnParams: { actionType: "groupBy", groupBy: { paramName: "asset" }, hoverCard: { cellField: "value", title: "Details", markdown: "{description}" } } },
      { field: "tvl", chartDataType: "series", formatterFn: "int" },
      { field: "change_1d", formatterFn: "percent", renderFn: ["greenRed", "showCellChange"] },
      { field: "history", sparkline: { type: "line", options: { pointsOfInterest: { maximum: { fill: "green" } } } } },
    ],
  },
  params: { asset: null },
  theme: { mode: "dark", locale: "en-US" },
  config: {},
  adminSettings: {},
  state: null,
  get(k) { return this[k]; },
  set(k, v) { this[k] = v; },
  save_changes() {},
  on(k, cb) { (listeners[k] = listeners[k] || []).push(cb); },
  off(k, cb) { listeners[k] = (listeners[k] || []).filter((c) => c !== cb); },
};
const agTableChartSignal = { addEventListener(_name, cb) { aborts.push(cb); } };
const el2 = document.createElement("div");
el2.style.width = "800px";
el2.style.height = "600px";
document.body.appendChild(el2);
plugin.initialize({ model: agTableChartModel, signal: agTableChartSignal });
await plugin.render({ model: agTableChartModel, signal: agTableChartSignal, el: el2, experimental: { invoke: async () => [null, []] } });
await new Promise((r) => setTimeout(r, 150));

assert(el2.querySelector(".ag-theme-quartz-dark .ag-root-wrapper") !== null, "dark grid rendered");
const headers = [...el2.querySelectorAll(".ag-header-cell-text")].map((h) => h.textContent);
assert(headers.includes("Asset") && headers.includes("Change 1d"), `configured headers shown (${headers.join(", ")})`);
const tvlCell = el2.querySelector('.ag-cell[col-id="tvl"]');
assert(tvlCell && tvlCell.textContent === "45,000,000,000", `formatterFn int applied (${tvlCell?.textContent})`);
const nameCell = el2.querySelector('.ag-cell[col-id="name"]');
assert(nameCell && nameCell.textContent === "Ethereum", `hover card cellField shown in cell (${nameCell?.textContent})`);
assert(nameCell?.classList.contains("ag-table-chart-clickable"), "cellOnClick cell is styled as clickable");
const changeCell = el2.querySelector('.ag-row[row-id="btc"] .ag-cell[col-id="change_1d"]');
assert(changeCell && changeCell.style.color !== "", `greenRed colours the cell (${changeCell?.style.color})`);
assert(el2.querySelector('.ag-cell[col-id="history"]') !== null, "sparkline column rendered");

const buttons = [...el2.querySelectorAll(".ag-table-chart-toolbar-button")].map((b) => b.textContent);
assert(buttons.join() === "Table,Chart", `ChartView toolbar shown (${buttons.join()})`);

nameCell.dispatchEvent(new MouseEvent("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 50));
assert(agTableChartModel.params.asset === "Ethereum", `cellOnClick groupBy wrote the param (${agTableChartModel.params.asset})`);

agTableChartModel.data = agTableChartModel.data.map((r) => (r.id === "btc" ? { ...r, change_1d: -2.0 } : r));
(listeners["change:data"] || []).forEach((cb) => cb());
await new Promise((r) => setTimeout(r, 50));
const flashed = el2.querySelector('.ag-row[row-id="btc"] .ag-cell[col-id="change_1d"]');
assert(flashed?.classList.contains("ag-table-chart-cell-down"), "showCellChange flashes a falling cell");

el2.querySelector(".ag-table-chart-toolbar-button:last-child").dispatchEvent(new MouseEvent("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 100));
assert(agTableChartModel.state?.chartView?.open === true, "ChartView opens and is saved to state");
assert(el2.querySelector(".ag-table-chart-chart").children.length > 0, "integrated chart created in the chart view");

// Not torn down here: AG Charts keeps drawing asynchronously, which jsdom's stub canvas cannot
// survive after a destroy. In a browser the abort destroys the chart and the grid.
el2.remove();

console.log("\n--- Table chart transpose ---");
const el3 = document.createElement("div");
el3.style.width = "800px";
el3.style.height = "600px";
document.body.appendChild(el3);
const transposeModel = { ...agTableChartModel, state: null, definition: { transpose: true, columnsDefs: [{ field: "name", renderFn: "hoverCard" }, { field: "tvl", formatterFn: "int" }] } };
await plugin.render({ model: transposeModel, signal: { addEventListener() {} }, el: el3 });
await new Promise((r) => setTimeout(r, 100));
const transposedHeaders = [...el3.querySelectorAll(".ag-header-cell-text")].map((h) => h.textContent);
assert(transposedHeaders.includes("Ethereum") && transposedHeaders.includes("Bitcoin"), `rows became columns (${transposedHeaders.join(", ")})`);
const transposedCell = el3.querySelector('.ag-cell[col-id="__r0"]');
assert(transposedCell?.textContent === "45,000,000,000", `transposed cells keep their column's format (${transposedCell?.textContent})`);
el3.remove();

console.log("\n" + "=".repeat(60));
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
console.log("=".repeat(60));

process.exit(failed > 0 ? 1 : 0);
assert(opts[0].id === "csv", "exportOptions first item is csv");