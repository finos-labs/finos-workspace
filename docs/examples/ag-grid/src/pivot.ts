/**
 * The pivot table: AG Grid Enterprise's pivot mode, made here from AG Grid's own column
 * keys, as the grouping is. The row columns' values make the rows, the pivot columns'
 * values make the columns, and each cell is a measure's aggregate of the rows that have
 * both. The result is flat rows, so AG Grid Community sorts and filters it as any grid.
 * Pure functions, tested without a browser.
 */
import { aggregate, BLANK, groupValue, type Measure } from "./grouping";
import type { Row } from "./spec";

/** At most this many pivot keys (combinations of the pivot columns' values) become columns. */
export const MAX_PIVOT_KEYS = 100;

/** The label column's field when no column makes the rows: the table is one row of totals. */
export const LABEL_FIELD = "__label";
export const TOTAL_LABEL = "Total";

export const pivotField = (key: number, measure: number) => `__pivot:${key}:${measure}`;
export const totalField = (measure: number) => `__total:${measure}`;

export interface PivotTable {
  /** One per combination of the row columns' values: those values, then a cell per pivot key and measure. */
  rows: Row[];
  /** The pivot keys shown as columns, in order: one value per pivot column. */
  keys: string[][];
  /** How many pivot keys were left out, past MAX_PIVOT_KEYS. */
  hidden: number;
  /** The grand totals, of every row, the left-out keys' included. */
  totals: Row;
}

function compare(a: string, b: string): number {
  if (a === b) return 0;
  if (a === BLANK) return 1;
  if (b === BLANK) return -1;
  return a.localeCompare(b, undefined, { numeric: true });
}

function compareKeys(a: readonly string[], b: readonly string[]): number {
  for (let index = 0; index < a.length; index++) {
    const order = compare(a[index] ?? "", b[index] ?? "");
    if (order) return order;
  }
  return 0;
}

/** Each measure's aggregate of the rows; without measures, how many rows there are. */
function cells(rows: readonly Row[], measures: readonly Measure[]): (number | null)[] {
  if (!measures.length) return [rows.length];
  const aggregates = aggregate(rows, measures);
  return measures.map((measure) => aggregates[measure.field] ?? null);
}

/**
 * The pivot of the rows. Rows and columns are ordered by value, blanks last; a row column's
 * cells keep the first row's value, so their formats apply, and blanks read "(blank)".
 * Without pivot columns, the table has the totals only; without row columns, it is one row.
 */
export function pivotTable(
  rows: readonly Row[],
  rowBy: readonly string[],
  pivotBy: readonly string[],
  measures: readonly Measure[],
): PivotTable {
  const keyOf = (row: Row) => pivotBy.map((field) => groupValue(row[field]));
  const seen = new Map<string, string[]>();
  if (pivotBy.length)
    for (const row of rows) {
      const key = keyOf(row);
      seen.set(JSON.stringify(key), key);
    }
  const sorted = [...seen.values()].sort(compareKeys);
  const keys = sorted.slice(0, MAX_PIVOT_KEYS);
  const indexOf = new Map(keys.map((key, index) => [JSON.stringify(key), index]));

  const line = (subset: readonly Row[], base: Row): Row => {
    const out: Row = { ...base };
    const byKey = new Map<number, Row[]>();
    if (pivotBy.length)
      for (const row of subset) {
        const index = indexOf.get(JSON.stringify(keyOf(row)));
        if (index === undefined) continue;
        const bucket = byKey.get(index);
        if (bucket) bucket.push(row);
        else byKey.set(index, [row]);
      }
    for (const [index, bucket] of byKey)
      cells(bucket, measures).forEach((value, measure) => {
        out[pivotField(index, measure)] = value;
      });
    cells(subset, measures).forEach((value, measure) => {
      out[totalField(measure)] = value;
    });
    return out;
  };

  const buckets = new Map<string, { values: string[]; rows: Row[] }>();
  for (const row of rows) {
    const values = rowBy.map((field) => groupValue(row[field]));
    const id = JSON.stringify(values);
    const bucket = buckets.get(id);
    if (bucket) bucket.rows.push(row);
    else buckets.set(id, { values, rows: [row] });
  }
  const tableRows = rowBy.length
    ? [...buckets.values()]
        .sort((a, b) => compareKeys(a.values, b.values))
        .map(({ values, rows: subset }) => {
          const first = subset[0] ?? {};
          const base = Object.fromEntries(
            rowBy.map((field, index) => [field, values[index] === BLANK ? BLANK : first[field]]),
          );
          return line(subset, base);
        })
    : [line(rows, { [LABEL_FIELD]: TOTAL_LABEL })];

  const totals = line(rows, rowBy.length ? { [rowBy[0] as string]: TOTAL_LABEL } : { [LABEL_FIELD]: TOTAL_LABEL });
  return { rows: tableRows, keys, hidden: sorted.length - keys.length, totals };
}

/** A cell's name for the agent and the exports: the key's values, then the measure. */
export function pivotLabel(key: readonly string[] | null, measure: Measure | undefined): string {
  const value = measure ? `${measure.field} (${measure.aggFunc})` : "rows";
  return key?.length ? `${key.join(" / ")} · ${value}` : `${TOTAL_LABEL} · ${value}`;
}
