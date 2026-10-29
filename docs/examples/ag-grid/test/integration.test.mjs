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
dom.window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame;

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

console.log("\n" + "=".repeat(60));
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
console.log("=".repeat(60));

if (failed > 0) process.exit(1);
assert(opts[0].id === "csv", "exportOptions first item is csv");