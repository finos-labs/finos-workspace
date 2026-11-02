import assert from "node:assert/strict";
import { test } from "node:test";

import "./dom.mjs";
import { formatCell, gridColumns, gridRows } from "../src/sql.js";

const result = {
  columns: [{ name: "site", type: "VARCHAR" }, { name: "n", type: "BIGINT" }, { name: "n", type: "BIGINT" }, { name: "a.b", type: "VARCHAR" }],
  rows: [["north", 1234567, 2, null], ["south", 3, 4, "x"]],
  truncated: false,
};

test("a result as AgGrid columns and rows, addressed by position", () => {
  const columns = gridColumns(result);
  assert.deepEqual(columns.map((c) => [c.field, c.headerName]), [["0", "site"], ["1", "n"], ["2", "n"], ["3", "a.b"]]);
  assert.equal(columns[0].type, undefined);
  assert.equal(columns[1].type, "numericColumn");
  assert.deepEqual(gridRows(result)[0], { 0: "north", 1: 1234567, 2: 2, 3: null });
});

test("a cell shows NULL, grouped numbers and JSON", () => {
  assert.equal(formatCell({ value: null }), "NULL");
  assert.equal(formatCell({ value: 1234567.5 }), new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(1234567.5));
  assert.equal(formatCell({ value: "12345678901234567890" }), "12345678901234567890");
  assert.equal(formatCell({ value: { a: 1 } }), '{"a":1}');
});
