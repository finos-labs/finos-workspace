import assert from "node:assert/strict";
import { test } from "node:test";

import { makeModel, mount, settle } from "./dom.mjs";
import plugin, { columnDefsOf, DEFAULT_PAGE_SIZE, optionsFor, PIVOT_SEPARATOR } from "../src/ssrm.js";

const columns = [
  { name: "region", type: "text", kind: "text" },
  { name: "qty", type: "integer", kind: "number" },
  { name: "traded", type: "date", kind: "date" },
];

test("columns become filters, formatters and aggregation by kind", () => {
  const defs = columnDefsOf(columns);
  assert.deepEqual(defs.map((d) => d.filter), ["agTextColumnFilter", "agNumberColumnFilter", "agDateColumnFilter"]);
  assert.equal(defs[1].enableValue, true);
  assert.equal(defs[0].enableValue, false);
  assert.equal(defs[1].type, "numericColumn");
});

test("the grid pages on the server and keeps the panels on", () => {
  const options = optionsFor({ definition: { table: "demo.trades", pageSize: 50 }, columns, datasource: {}, mode: "dark" });
  assert.equal(options.rowModelType, "serverSide");
  assert.equal(options.pagination, true);
  assert.equal(options.paginationPageSize, 50);
  assert.equal(options.cacheBlockSize, 50);
  assert.equal(options.serverSidePivotResultFieldSeparator, PIVOT_SEPARATOR);
  assert.equal(options.rowData, undefined);
  assert.equal(options.pivotPanelShow, "always");
  assert.equal(optionsFor({ definition: {}, columns, datasource: {}, mode: "dark" }).cacheBlockSize, DEFAULT_PAGE_SIZE);
});

test("the widget asks its backend for the columns and the rows of the table", async () => {
  const calls = [];
  const experimental = {
    async invoke(name, message) {
      calls.push([name, message.route, message.args]);
      if (message.route === "ssrm_columns") return [{ columns }];
      const request = JSON.parse(message.args.request);
      return [{ rows: [{ region: "emea", qty: 3 }], rowCount: 1, pivotResultFields: undefined, request }];
    },
  };
  const model = makeModel({ definition: { table: "demo.trades" } });
  const { el, abort } = mount();
  const exposed = plugin.initialize({ model });
  await plugin.render({ model, signal: abort.signal, el, experimental });
  await settle(400);

  assert.deepEqual(calls[0], ["core:backend:call", "ssrm_columns", { table: "demo.trades" }]);
  const rowCalls = calls.filter(([, route]) => route === "ssrm_rows");
  assert.ok(rowCalls.length > 0);
  assert.equal(rowCalls[0][2].table, "demo.trades");
  assert.equal(JSON.parse(rowCalls[0][2].request).startRow, 0);
  assert.deepEqual(exposed.exportOptions(), []);
  assert.equal(exposed.copilotContext().table, "demo.trades");
  assert.deepEqual(exposed.copilotContext().columns, ["region", "qty", "traded"]);

  abort.abort();
});

test("a refused call is said in words", async () => {
  const model = makeModel({ definition: { table: "demo.trades" } });
  const { el, abort } = mount();
  plugin.initialize({ model });
  const experimental = {
    async invoke() {
      throw Object.assign(new Error("x"), { name: "unavailable" });
    },
  };
  await plugin.render({ model, signal: abort.signal, el, experimental });
  assert.match(el.querySelector(".ag-strip").textContent, /not available/);
  abort.abort();
});

test("a widget with no table says so", async () => {
  const model = makeModel({ definition: {} });
  const { el, abort } = mount();
  plugin.initialize({ model });
  await assert.rejects(plugin.render({ model, signal: abort.signal, el, experimental: {} }), /names no table/);
});
