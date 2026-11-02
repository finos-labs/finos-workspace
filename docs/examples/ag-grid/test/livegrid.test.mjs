import assert from "node:assert/strict";
import { test } from "node:test";

import { makeModel, mount, settle } from "./dom.mjs";
import plugin, { applyMessage, FLUSH_MS, statusText } from "../src/livegrid.js";

const columnDefs = [{ field: "id" }, { field: "symbol" }, { field: "price" }];
const rows = [
  { id: "a", symbol: "AAA", price: 1 },
  { id: "b", symbol: "BBB", price: 2 },
];

const stream = (model, ...messages) => model.emit("msg:custom", { kind: "workspace-event", name: "stream", messages });
const status = (model, state, retryIn) => model.emit("msg:custom", { kind: "workspace-event", name: "stream-status", state, retryIn });

test("messages change the rows by id", () => {
  const byId = new Map();
  let change = applyMessage(byId, { op: "snapshot", rows });
  assert.equal(change.replaced, true);
  assert.deepEqual([...byId.keys()], ["a", "b"]);
  change = applyMessage(byId, { op: "upsert", rows: [{ id: "b", symbol: "BBB", price: 3 }, { id: "c" }, { symbol: "no id" }] });
  assert.deepEqual([...change.touched], ["b", "c"]);
  assert.equal(byId.get("b").price, 3);
  change = applyMessage(byId, { op: "remove", ids: ["a", "zzz"] });
  assert.deepEqual([...change.removed], ["a", "zzz"]);
  assert.equal(byId.has("a"), false);
  const nothing = applyMessage(byId, { op: "who knows" });
  assert.equal(nothing.touched.size + nothing.removed.size, 0);
  assert.equal(applyMessage(byId, null).replaced, false);
});

test("the strip says what the host reports", () => {
  assert.equal(statusText({ state: "connecting" }), "Connecting…");
  assert.equal(statusText({ state: "live" }), "Live");
  assert.equal(statusText({ state: "retrying", retryIn: 4 }), "Disconnected, retrying in 4 s");
  assert.equal(statusText({ state: "closed" }), "Closed");
});

test("the grid follows the host's stream and flashes what changed", async () => {
  const model = makeModel({ data: { columnDefs, rowData: rows } });
  const { el, abort } = mount();
  const exposed = plugin.initialize({ model });
  await plugin.render({ model, signal: abort.signal, el });
  await settle();

  assert.equal(el.querySelector(".ag-strip").textContent, "Connecting…");
  status(model, "live");
  assert.equal(el.querySelector(".ag-strip").textContent, "Live");
  assert.equal(el.querySelector(".ag-strip").dataset.live, "true");

  stream(model, { op: "upsert", rows: [{ id: "b", symbol: "BBB", price: 5 }, { id: "c", symbol: "CCC", price: 9 }] }, { op: "remove", ids: ["a"] });
  await settle(FLUSH_MS * 2);
  const ctx = exposed.copilotContext();
  assert.equal(ctx.rowCount, 2);
  assert.equal(ctx.stats.price.sum, 14);
  assert.ok(el.querySelector(".ag-cell-data-changed, .ag-cell-data-changed-animation"));

  stream(model, { op: "snapshot", rows: [{ id: "z", symbol: "ZZZ", price: 1 }] });
  await settle(FLUSH_MS * 2);
  assert.equal(exposed.copilotContext().rowCount, 1);

  status(model, "retrying", 2);
  assert.equal(el.querySelector(".ag-strip").textContent, "Disconnected, retrying in 2 s");

  stream(model, { op: "upsert", rows: [{ id: "z", symbol: "ZZZ", price: 4 }] });
  model.emit("msg:custom", { kind: "something-else", name: "stream", messages: [{ op: "snapshot", rows: [] }] });
  await settle(FLUSH_MS * 2);
  assert.equal(exposed.copilotContext().stats.price.sum, 4);

  abort.abort();
  assert.equal(model.listenerCount("msg:custom"), 0);
  assert.equal(model.listenerCount("change:theme"), 0);
});

test("rows without ids are refused", async () => {
  const model = makeModel({ data: { columnDefs, rowData: [{ symbol: "x" }] } });
  const { el, abort } = mount();
  plugin.initialize({ model });
  await assert.rejects(plugin.render({ model, signal: abort.signal, el }), /needs an id/);
});
