/*
 * Completion for the SQL editor, from DuckDB itself.
 *
 * DuckDB-WASM runs in the widget's frame and holds an empty copy of the schema the
 * explorer shows: the tables and their columns, no rows. Its sql_auto_complete answers
 * what may come next at the end of the text it is given: keywords, functions, tables and
 * columns, each with where it starts. The editor gives it the text up to the cursor.
 * Nothing leaves the frame while the user types.
 */

export const MAX_SUGGESTIONS = 50;
// What DuckDB would otherwise download on first use: sql_auto_complete, and json
export const EXTENSIONS = ["autocomplete", "json"];
const SUGGEST = `SELECT suggestion, suggestion_start FROM sql_auto_complete(?) LIMIT ${MAX_SUGGESTIONS}`;

function quoted(name) {
  return `"${String(name).replaceAll('"', '""')}"`;
}

/**
 * The statements that copy a schema, empty, into a database of its own: tables of the
 * default schema (Postgres's public, DuckDB's main) in main, others in schemas of their
 * names. Every column is VARCHAR: completion needs the names.
 */
export function mirrorStatements(tables) {
  const statements = ["USE memory", "DETACH DATABASE IF EXISTS mirror", "ATTACH ':memory:' AS mirror", "USE mirror"];
  const schemas = new Set();
  for (const table of tables) {
    const schema = table.schema && table.schema !== "public" && table.schema !== "main" ? table.schema : null;
    if (schema && !schemas.has(schema)) {
      schemas.add(schema);
      statements.push(`CREATE SCHEMA ${quoted(schema)}`);
    }
    const columns = table.columns.length
      ? table.columns.map((column) => `${quoted(column.name)} VARCHAR`).join(", ")
      : '"?" VARCHAR';
    statements.push(`CREATE TABLE ${schema ? `${quoted(schema)}.` : ""}${quoted(table.name)} (${columns})`);
  }
  return statements;
}

/** What kind of thing a suggestion is, for the list: a table, a column, a keyword or a function. */
export function kindOf(text, names) {
  const bare = text.replace(/^"(.*)"$/, "$1");
  if (names.tables.has(bare)) return "table";
  if (names.columns.has(bare)) return "column";
  if (text.endsWith(" ")) return "keyword";
  return "function";
}

/**
 * Suggestions worth showing for `text`, the text up to the cursor: no punctuation, nothing
 * the user already typed whole, and after a dot names only.
 */
export function usable(rows, text, names) {
  const afterDot = /\.\s*$/.test(text) || /\.[A-Za-z0-9_"]*$/.test(text);
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const suggestion = String(row.suggestion);
    const start = Number(row.suggestion_start);
    if (!/[A-Za-z_]/.test(suggestion) || seen.has(suggestion)) continue;
    const typed = text.slice(start);
    if (suggestion.trim() === typed) continue;
    const kind = kindOf(suggestion, names);
    if (afterDot && kind === "keyword") continue;
    seen.add(suggestion);
    out.push({ text: suggestion, start, kind });
  }
  return out;
}

/**
 * Completion on a DuckDB connection that can reach the packaged extensions: they load now,
 * and then DuckDB may load no other and change no setting.
 */
export async function completerFor(connection) {
  for (const name of EXTENSIONS) await connection.query(`LOAD ${name}`);
  for (const setting of [
    "SET autoinstall_known_extensions = false",
    "SET autoload_known_extensions = false",
    "SET lock_configuration = true",
  ])
    await connection.query(setting);
  return Completer.open(connection);
}

/**
 * Completion over one DuckDB connection: the schema it mirrors, and what it suggests. The
 * connection is DuckDB-WASM's, asynchronous in the browser (DuckDB runs in a worker) and
 * synchronous in Node's tests; every call is awaited, so either serves.
 */
export class Completer {
  static async open(connection) {
    const completer = new Completer(connection);
    completer.statement = await connection.prepare(SUGGEST);
    return completer;
  }

  constructor(connection) {
    this.connection = connection;
    this.statement = null;
    this.names = { tables: new Set(), columns: new Set() };
  }

  /** Mirrors `tables`, replacing what was mirrored before. A table DuckDB will not take is left out. */
  async mirror(tables) {
    for (const statement of mirrorStatements(tables)) {
      try {
        await this.connection.query(statement);
      } catch {
        // A name DuckDB refuses, or a column named twice: that table has no completion
      }
    }
    this.names = {
      tables: new Set(tables.map((t) => t.name)),
      columns: new Set(tables.flatMap((t) => t.columns.map((c) => c.name))),
    };
  }

  /** What may come at the end of `text`. */
  async suggest(text) {
    const answer = await this.statement.query(text);
    return usable(answer.toArray().map((row) => row.toJSON()), text, this.names);
  }
}
