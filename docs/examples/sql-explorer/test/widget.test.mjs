import assert from "node:assert/strict";
import { test } from "node:test";

import widget, { contextOf, csvOf, identifier, isNumeric, SOURCES, stateOf } from "../src/entry.js";

test("a name is quoted only when it has to be", () => {
  assert.equal(identifier("readings"), "readings");
  assert.equal(identifier("Readings 2026"), '"Readings 2026"');
  assert.equal(identifier('say "hi"'), '"say ""hi"""');
});

test("a result as CSV, values quoted where they need it", () => {
  const result = {
    columns: [{ name: "site" }, { name: "note" }, { name: "tags" }],
    rows: [
      ["north", 'a, "b"', ["x", "y"]],
      ["south", null, null],
    ],
  };
  assert.equal(csvOf(result), 'site,note,tags\nnorth,"a, ""b""","[""x"",""y""]"\nsouth,,');
});

test("the agent gets the query and the shape of the answer, not its values", () => {
  const run = {
    source: "files",
    sql: "SELECT * FROM readings",
    result: { columns: [{ name: "id", type: "BIGINT" }], rows: [[1], [2]], truncated: false },
  };
  assert.deepEqual(contextOf(run), {
    source: "Files",
    sql: "SELECT * FROM readings",
    columns: [{ name: "id", type: "BIGINT" }],
    rows: 2,
    truncated: false,
  });
  assert.deepEqual(contextOf({ source: "postgres", sql: "SELECT", error: "syntax error" }), {
    source: "Postgres",
    sql: "SELECT",
    error: "syntax error",
  });
  assert.equal(contextOf(null), null);
});

test("saved state is completed and bounded", () => {
  assert.deepEqual(stateOf(undefined), {
    source: "postgres",
    sql: { postgres: SOURCES.postgres.sql, files: SOURCES.files.sql },
  });
  const state = stateOf({ source: "files", sql: { files: "SELECT 1", postgres: 42 }, extra: true });
  assert.deepEqual(state, { source: "files", sql: { postgres: SOURCES.postgres.sql, files: "SELECT 1" } });
  assert.equal(stateOf({ source: "other" }).source, "postgres");
  assert.equal(stateOf({ sql: { files: "x".repeat(40_000) } }).sql.files.length, 32_768);
});

test("numbers line up as numbers, and only they", () => {
  for (const type of ["int4", "int8", "numeric(10,2)", "BIGINT", "DECIMAL(18,3)", "DOUBLE", "float8", "HUGEINT"])
    assert.ok(isNumeric({ type }, "1"), type);
  for (const type of ["interval", "text", "VARCHAR", "timestamptz", "INTERVAL"])
    assert.ok(!isNumeric({ type }, "1"), type);
  assert.ok(isNumeric({ type: "text" }, 3));
});

test("nothing to export before a query ran", async () => {
  const exports = widget.initialize();
  assert.deepEqual(await exports.exportOptions(), []);
  assert.equal(await exports.exportData("csv"), null);
  assert.equal(await exports.copilotContext(), null);
});
