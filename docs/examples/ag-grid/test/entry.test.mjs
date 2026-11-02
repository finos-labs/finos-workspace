import assert from "node:assert/strict";
import { test } from "node:test";

import { makeModel } from "./dom.mjs";
import entry from "../src/entry.js";

test("the plugin hands each widget its own module", () => {
  const exposed = entry.initialize({ model: makeModel({ meta: { widgetId: "ssrm" }, definition: {} }) });
  assert.deepEqual(exposed.exportOptions(), []);
  const table = entry.initialize({ model: makeModel({ meta: { widgetId: "table" } }) });
  assert.equal(table.exportOptions()[0].id, "csv");
});

test("an unknown widget is refused", () => {
  assert.throws(() => entry.initialize({ model: makeModel({ meta: { widgetId: "other" } }) }), /no widget by that id/);
});
