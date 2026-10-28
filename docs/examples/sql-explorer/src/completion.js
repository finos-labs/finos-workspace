export const MAX_SUGGESTIONS = 50;
export const EXTENSIONS = ["autocomplete", "json"];
const SUGGEST = `SELECT suggestion, suggestion_start FROM sql_auto_complete(?) LIMIT ${MAX_SUGGESTIONS}`;

function quoted(name) {
  return `"${String(name).replaceAll('"', '""')}"`;
}

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

export function kindOf(text, names) {
  const bare = text.replace(/^"(.*)"$/, "$1");
  if (names.tables.has(bare)) return "table";
  if (names.columns.has(bare)) return "column";
  if (text.endsWith(" ")) return "keyword";
  return "function";
}

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

  async mirror(tables) {
    for (const statement of mirrorStatements(tables)) {
      try {
        await this.connection.query(statement);
      } catch {
      }
    }
    this.names = {
      tables: new Set(tables.map((t) => t.name)),
      columns: new Set(tables.flatMap((t) => t.columns.map((c) => c.name))),
    };
  }

  async suggest(text) {
    const answer = await this.statement.query(text);
    return usable(answer.toArray().map((row) => row.toJSON()), text, this.names);
  }
}
