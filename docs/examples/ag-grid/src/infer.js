/* Column type inference for rows that come without column definitions. */

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export function inferType(value) {
  if (value === null || value === undefined) return "empty";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return Number.isFinite(value) ? "numeric" : "empty";
  if (typeof value === "string") {
    if (value === "") return "empty";
    if (ISO_DATE_RE.test(value)) return "date";
    return "string";
  }
  if (Array.isArray(value)) return "array";
  return "object";
}

export function inferColumnType(values) {
  const counts = {};
  for (const v of values) {
    const t = inferType(v);
    counts[t] = (counts[t] || 0) + 1;
  }
  const order = ["boolean", "numeric", "date", "string", "array", "object"];
  let best = "string";
  let bestCount = 0;
  for (const t of order) {
    const c = counts[t] || 0;
    if (c > bestCount) { best = t; bestCount = c; }
  }
  return best;
}

/** The fields of the rows, in the order they first appear. */
export function fieldsOf(rows, limit = 50) {
  const fields = [];
  const seen = new Set();
  for (const row of rows.slice(0, limit)) {
    if (!row || typeof row !== "object") continue;
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) { seen.add(key); fields.push(key); }
    }
  }
  return fields;
}
