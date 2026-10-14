// Completion against DuckDB itself: the same Completer the widget uses, over DuckDB-WASM's
// Node build and the same binary the frame receives (assets/duckdb-eh.wasm).
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { completerFor, EXTENSIONS, kindOf, mirrorStatements, usable } from "../src/completion.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const duckdb = createRequire(import.meta.url)("@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs");
const dist = join(root, "node_modules/@duckdb/duckdb-wasm/dist");

const POSTGRES = [
  { schema: "demo", name: "monthly_sales", columns: [{ name: "month" }, { name: "region" }, { name: "units" }, { name: "revenue" }] },
  { schema: "demo", name: "regions", columns: [{ name: "region" }, { name: "name" }] },
  { schema: "public", name: "notes", columns: [{ name: "body" }] },
];
const FILES = [
  { schema: null, name: "readings", columns: [{ name: "taken_at" }, { name: "sensor" }, { name: "celsius" }] },
  { schema: null, name: "stations", columns: [{ name: "sensor" }, { name: "site" }] },
];

let completer;

before(async () => {
  // DuckDB-WASM's Node build reads extensions from $HOME/.duckdb/extensions/<repository>/
  // <version>/<platform>/: a home of the test's own, with the build's verified copies, so
  // nothing is downloaded and the user's home is not touched
  const home = mkdtempSync(join(tmpdir(), "sql-explorer-test-"));
  const extensions = join(home, ".duckdb/extensions/extensions.duckdb.org/v1.5.4/wasm_eh");
  mkdirSync(extensions, { recursive: true });
  for (const name of EXTENSIONS)
    copyFileSync(join(root, ".cache/v1.5.4", `${name}.duckdb_extension.wasm`), join(extensions, `${name}.duckdb_extension.wasm`));
  process.env.HOME = home;
  const db = await duckdb.createDuckDB(
    { mvp: { mainModule: join(dist, "duckdb-mvp.wasm") }, eh: { mainModule: join(dist, "duckdb-eh.wasm") } },
    new duckdb.VoidLogger(),
    duckdb.NODE_RUNTIME,
  );
  await db.instantiate();
  db.open({});
  completer = await completerFor(db.connect());
});

const texts = (found) => found.map((s) => s.text);

test("the schema is mirrored empty, outside schemas in their own, the default one in main", () => {
  assert.deepEqual(mirrorStatements(POSTGRES), [
    "USE memory",
    "DETACH DATABASE IF EXISTS mirror",
    "ATTACH ':memory:' AS mirror",
    "USE mirror",
    'CREATE SCHEMA "demo"',
    'CREATE TABLE "demo"."monthly_sales" ("month" VARCHAR, "region" VARCHAR, "units" VARCHAR, "revenue" VARCHAR)',
    'CREATE TABLE "demo"."regions" ("region" VARCHAR, "name" VARCHAR)',
    'CREATE TABLE "notes" ("body" VARCHAR)',
  ]);
});

test("keywords, tables and columns come from DuckDB, marked by kind", async () => {
  await completer.mirror(POSTGRES);
  const keywords = await completer.suggest("SEL");
  assert.equal(keywords[0].text, "SELECT ");
  assert.equal(keywords[0].kind, "keyword");
  assert.equal(keywords[0].start, 0);

  const tables = await completer.suggest("SELECT * FROM demo.re");
  assert.ok(texts(tables).includes("regions"), texts(tables).join());
  assert.equal(tables.find((s) => s.text === "regions").kind, "table");
  assert.equal(tables[0].start, 19);

  const columns = await completer.suggest("SELECT re");
  assert.deepEqual(
    columns.filter((s) => s.kind === "column").map((s) => s.text).slice(0, 2).sort(),
    ["region", "revenue"],
  );
});

test("after a dot, names only", async () => {
  await completer.mirror(POSTGRES);
  for (const suggestion of await completer.suggest("SELECT * FROM demo.")) assert.notEqual(suggestion.kind, "keyword");
});

test("another source replaces what the other mirrored", async () => {
  await completer.mirror(POSTGRES);
  assert.ok(texts(await completer.suggest("SELECT * FROM reg")).includes("regions"));
  await completer.mirror(FILES);
  const found = texts(await completer.suggest("SELECT * FROM rea"));
  assert.ok(found.includes("readings"), found.join());
  assert.ok(!texts(await completer.suggest("SELECT * FROM reg")).includes("regions"));
  assert.ok(texts(await completer.suggest("SELECT * FROM readings WHERE sen")).includes("sensor"));
});

test("a table DuckDB will not take is left out, and the rest still complete", async () => {
  await completer.mirror([
    { schema: null, name: "twice", columns: [{ name: "a" }, { name: "a" }] },
    { schema: null, name: 'odd "name"', columns: [{ name: "x y" }] },
    ...FILES,
  ]);
  assert.ok(texts(await completer.suggest("SELECT * FROM sta")).includes("stations"));
  assert.ok(!texts(await completer.suggest("SELECT * FROM twi")).includes("twice"));
});

test("only what is worth showing", () => {
  const names = { tables: new Set(["readings"]), columns: new Set(["sensor"]) };
  const rows = [
    { suggestion: "(", suggestion_start: 5 },
    { suggestion: "readings", suggestion_start: 14 },
    { suggestion: "readings", suggestion_start: 14 },
    { suggestion: "read ", suggestion_start: 14 },
    { suggestion: "sum", suggestion_start: 14 },
  ];
  assert.deepEqual(usable(rows, "SELECT * FROM rea", names), [
    { text: "readings", start: 14, kind: "table" },
    { text: "read ", start: 14, kind: "keyword" },
    { text: "sum", start: 14, kind: "function" },
  ]);
  // What is already typed whole is not suggested again
  assert.deepEqual(usable([{ suggestion: "readings", suggestion_start: 14 }], "SELECT * FROM readings", names), []);
  assert.equal(kindOf('"sensor"', names), "column");
});
