import { DatabaseSync } from "node:sqlite";
import { FETCH_MISSING_TABLE_HINT, NO_TABLES_LOADED_MESSAGE } from "./error-hints.ts";

export const MAX_SQL_TABLE_ROWS = 200_000;

const SQL_MAX_VALUE_BYTES = 64 * 1024 * 1024;

interface LoadedTable {
  tableName: string;
  columns: { name: string; originalName: string; type: string }[];
  rowCount: number;
}

function sanitize(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/^(\d)/, "col_$1")
    .toLowerCase();
}

const TYPE_SAMPLE_LIMIT = 500;

function inferType(rows: unknown[], key: string): string {
  const cap = Math.min(rows.length, TYPE_SAMPLE_LIMIT);
  for (let i = 0; i < cap; i++) {
    const v = (rows[i] as Record<string, unknown>)[key];
    if (v == null) continue;
    if (typeof v === "number") return Number.isInteger(v) ? "INTEGER" : "REAL";
    if (typeof v === "boolean") return "INTEGER";
    return "TEXT";
  }
  return "TEXT";
}

function dedupColumnNames<T extends { name: string }>(cols: T[]): T[] {
  const seen = new Map<string, number>();
  return cols.map((col) => {
    const count = (seen.get(col.name) ?? 0) + 1;
    seen.set(col.name, count);
    return count === 1 ? col : { ...col, name: `${col.name}_${count}` };
  });
}

function loadOne(db: DatabaseSync, name: string, rows: unknown[]): LoadedTable {
  const tableName = sanitize(name) || "data";
  const first = rows[0] as Record<string, unknown> | undefined;
  const originalKeys = first ? Object.keys(first) : [];
  const columns = dedupColumnNames(
    originalKeys.map((key) => ({
      name: sanitize(key),
      originalName: key,
      type: inferType(rows, key),
    })),
  );

  const colDefs = columns.map((c) => `"${c.name}" ${c.type}`).join(", ");
  db.exec(`CREATE TABLE IF NOT EXISTS "${tableName}" (${colDefs})`);

  const placeholders = columns.map(() => "?").join(", ");
  const insert = db.prepare(`INSERT INTO "${tableName}" VALUES (${placeholders})`);
  db.exec("BEGIN");
  try {
    for (const row of rows) {
      const values = originalKeys.map((key) => {
        const v = (row as Record<string, unknown>)[key];
        if (v == null) return null;
        if (typeof v === "object") return JSON.stringify(v);
        if (typeof v === "boolean") return v ? 1 : 0;
        return v as string | number;
      });
      insert.run(...values);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return { tableName, columns, rowCount: rows.length };
}

export function buildDb(
  tables: ReadonlyMap<string, Record<string, unknown>[]> | undefined,
): { db: DatabaseSync; loaded: LoadedTable[] } {
  const db = new DatabaseSync(":memory:", { limits: { length: SQL_MAX_VALUE_BYTES } });
  const loaded: LoadedTable[] = [];
  if (!tables) return { db, loaded };
  for (const [name, rows] of tables) {
    if (rows.length === 0) continue;
    loaded.push(loadOne(db, name, rows.length > MAX_SQL_TABLE_ROWS ? rows.slice(0, MAX_SQL_TABLE_ROWS) : rows));
  }
  return { db, loaded };
}

export function describeColumns(t: LoadedTable): string {
  return t.columns
    .map((c) => {
      const map = c.name !== c.originalName ? ` ← "${c.originalName}"` : "";
      return `  - "${c.name}"${map} (${c.type})`;
    })
    .join("\n");
}

export function tableNotFoundMessage(requested: string, loaded: LoadedTable[]): string {
  if (loaded.length === 0) return NO_TABLES_LOADED_MESSAGE;
  const names = loaded.map((t) => `"${t.tableName}"`).join(", ");
  return `Table "${requested}" not loaded. Available: ${names}.${FETCH_MISSING_TABLE_HINT}`;
}
