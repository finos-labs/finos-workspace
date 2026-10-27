export function sanitizeName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/^(\d)/, "col_$1")
    .toLowerCase();
}

export const TYPE_SAMPLE_LIMIT = 500;

function inferSqlType(rows: Record<string, unknown>[], key: string): string {
  const cap = Math.min(rows.length, TYPE_SAMPLE_LIMIT);
  for (let i = 0; i < cap; i++) {
    const v = rows[i][key];
    if (v == null) continue;
    if (typeof v === "number") return Number.isInteger(v) ? "INTEGER" : "REAL";
    if (typeof v === "boolean") return "INTEGER";
    return "TEXT";
  }
  return "TEXT";
}

export interface TableInfo {
  tableName: string;
  columns: { name: string; originalName: string; type: string }[];
  rowCount: number;
}

function dedupColumnNames<T extends { name: string }>(cols: T[]): T[] {
  const seen = new Map<string, number>();
  return cols.map((col) => {
    const count = (seen.get(col.name) ?? 0) + 1;
    seen.set(col.name, count);
    return count === 1 ? col : { ...col, name: `${col.name}_${count}` };
  });
}

export function analyzeTable(
  name: string,
  rows: Record<string, unknown>[],
): TableInfo {
  const tableName = sanitizeName(name) || "data";
  const originalKeys = Object.keys(rows[0] ?? {});
  const columns = dedupColumnNames(
    originalKeys.map((key) => ({
      name: sanitizeName(key),
      originalName: key,
      type: inferSqlType(rows, key),
    })),
  );
  return { tableName, columns, rowCount: rows.length };
}
