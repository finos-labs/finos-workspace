import assert from "node:assert/strict";
import { test } from "node:test";

import widget, { contextOf, csvOf, identifier, isNumeric, seedOf, SOURCES, startOf, stateOf } from "../src/entry.js";

test("a query the agent gives seeds the editor, for the source it names", () => {
  assert.equal(seedOf(undefined), null);
  assert.equal(seedOf({ source: "files" }), null);
  assert.equal(seedOf({ sql: "  " }), null);
  assert.deepEqual(seedOf({ source: "files", sql: "SELECT 1" }), { source: "files", sql: "SELECT 1" });
  assert.deepEqual(seedOf({ source: "oracle", sql: "SELECT 1" }), { source: null, sql: "SELECT 1" });
  assert.equal(seedOf({ sql: "x".repeat(100000) }).sql.length, 32768);
});

test("the seed is the start of a card that has not been used, and never replaces what the user saved", () => {
  const seeded = startOf(null, { source: "files", sql: "SELECT region FROM sales" });
  assert.equal(seeded.source, "files");
  assert.equal(seeded.sql.files, "SELECT region FROM sales");
  assert.equal(seeded.sql.postgres, stateOf(null).sql.postgres);
  const kept = startOf({ source: "postgres", sql: { postgres: "SELECT 2", files: "SELECT 3" } }, { source: "files", sql: "SELECT 1" });
  assert.deepEqual(kept, { source: "postgres", sql: { postgres: "SELECT 2", files: "SELECT 3" } });
  assert.deepEqual(startOf(null, undefined), stateOf(null));
  assert.equal(startOf(null, { sql: "SELECT 9" }).sql[stateOf(null).source], "SELECT 9");
});

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
