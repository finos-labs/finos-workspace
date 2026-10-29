/**
 * What the user has chosen in the view, and what is made from it outside the grid: the
 * search while grouped, the formats, the CSV of the rows, the state saved with the
 * dashboard and the agent's summary. Pure functions, tested without a browser.
 */
import { aggregate, buildGroupTree, collectGroupKeys, groupValue, type Measure } from "./grouping";
import { AGG_FUNCS, type AggFunc, type ColumnSpec, headerOf, type Row, type ValueFormat } from "./spec";

export interface ViewState {
  groupBy: string[];
  /** One function for every measure, or null for the one each column declares. */
  aggFunc: AggFunc | null;
  search: string;
}

/** The measures with the view's function applied. */
export function measuresOf(measures: readonly Measure[], aggFunc: AggFunc | null): Measure[] {
  return aggFunc ? measures.map((measure) => ({ ...measure, aggFunc })) : [...measures];
}

// ---------------------------------------------------------------- search

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/**
 * AG Grid's quick filter, for the rows the grid does not hold while grouped: every word of
 * the search is in one of the row's cells, case-insensitive.
 */
export function quickMatch(rows: readonly Row[], fields: readonly string[], search: string): Row[] {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...rows];
  return rows.filter((row) => {
    const cells = fields.map((field) => cellText(row[field]).toLowerCase());
    return words.every((word) => cells.some((cell) => cell.includes(word)));
  });
}

// ---------------------------------------------------------------- formats

/** A formatter for a column's `valueFormat`, in the user's locale. */
export function formatterOf(format: ValueFormat, locale: string): (value: unknown) => string {
  if (format.style === "date") {
    const dates = new Intl.DateTimeFormat(locale, { dateStyle: format.dateStyle ?? "medium" });
    return (value) => {
      if (value === null || value === undefined || value === "") return "";
      // A date-only string is a calendar day: read it as UTC so no time zone moves it
      const date = new Date(typeof value === "string" && value.length === 10 ? `${value}T00:00:00Z` : String(value));
      return Number.isNaN(date.getTime()) ? cellText(value) : dates.format(date);
    };
  }
  const numbers = new Intl.NumberFormat(locale, {
    style: format.style,
    currency: format.style === "currency" ? (format.currency ?? "USD") : undefined,
    notation: format.notation ?? "standard",
    ...(format.decimals === undefined
      ? {}
      : { minimumFractionDigits: format.decimals, maximumFractionDigits: format.decimals }),
  });
  return (value) => (typeof value === "number" && Number.isFinite(value) ? numbers.format(value) : cellText(value));
}

// ---------------------------------------------------------------- CSV

function quote(value: unknown): string {
  const text = cellText(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Every row the endpoint returned, one line each, every column, values as they came. */
export function rowsCsv(rows: readonly Row[], columns: readonly ColumnSpec[]): string {
  const header = columns.map(headerOf);
  const lines = rows.map((row) => columns.map((column) => row[column.field]));
  return [header, ...lines].map((line) => line.map(quote).join(",")).join("\n");
}

// ---------------------------------------------------------------- saved state

/** The parts of AG Grid's state saved with the dashboard: not the scroll or the focus. */
export const GRID_STATE_KEYS = [
  "columnOrder",
  "columnPinning",
  "columnSizing",
  "columnVisibility",
  "filter",
  "pagination",
  "sort",
] as const;

export interface SavedState {
  /** AG Grid's own state of the ungrouped grid (`api.getState()`, the keys above). */
  grid?: Record<string, unknown>;
  groupBy?: string[];
  aggFunc?: AggFunc | null;
  search?: string;
}

/** The trait's value, read defensively: it was written by another version, maybe. */
export function stateOf(value: unknown): SavedState {
  if (typeof value !== "object" || value === null) return {};
  const saved = value as Record<string, unknown>;
  const out: SavedState = {};
  if (typeof saved.grid === "object" && saved.grid !== null) {
    const grid = saved.grid as Record<string, unknown>;
    out.grid = Object.fromEntries(GRID_STATE_KEYS.filter((key) => key in grid).map((key) => [key, grid[key]]));
  }
  if (Array.isArray(saved.groupBy)) out.groupBy = saved.groupBy.filter((f): f is string => typeof f === "string");
  if (saved.aggFunc === null || (AGG_FUNCS as readonly unknown[]).includes(saved.aggFunc))
    out.aggFunc = saved.aggFunc as AggFunc | null;
  if (typeof saved.search === "string") out.search = saved.search.slice(0, 200);
  return out;
}

// ---------------------------------------------------------------- the agent's summary

/** At most this many rows and groups go to the agent. */
const SAMPLE_ROWS = 20;
const SUMMARY_GROUPS = 20;
const MAX_CELL = 200;

function short(value: unknown): unknown {
  if (typeof value === "string" && value.length > MAX_CELL) return `${value.slice(0, MAX_CELL)}…`;
  if (typeof value === "object" && value !== null) return short(JSON.stringify(value));
  return value;
}

export interface SummaryInput {
  columns: readonly ColumnSpec[];
  measures: readonly Measure[];
  /** Every row the endpoint returned. */
  rows: readonly Row[];
  /** The rows the view keeps (after the search and the filters), in the view's order. */
  shown: readonly Row[];
  view: ViewState;
  /** AG Grid's sort and filter state, when the grid is not grouped. */
  sort?: unknown;
  filter?: unknown;
}

/**
 * What the agent is told: the columns, how many rows there are and how many the view
 * keeps, the search, sort and filters, the first rows, and when grouped, the top-level
 * groups with their counts and aggregates.
 */
export function summary(input: SummaryInput) {
  const { columns, view } = input;
  const measures = measuresOf(input.measures, view.aggFunc);
  const rowOf = (row: Row) => Object.fromEntries(columns.map((c) => [c.field, short(row[c.field])]));
  const base = {
    columns: columns.map((column) => ({
      field: column.field,
      header: headerOf(column),
      type: column.cellDataType ?? "text",
    })),
    rows: input.rows.length,
    shown: input.shown.length,
    search: view.search || null,
    sort: input.sort ?? null,
    filter: input.filter ?? null,
  };
  if (!view.groupBy.length) {
    return { ...base, firstRows: input.shown.slice(0, SAMPLE_ROWS).map(rowOf) };
  }
  const tree = buildGroupTree(input.shown, view.groupBy, measures);
  const top = tree.filter((node) => node.kind === "group");
  return {
    ...base,
    groupBy: view.groupBy,
    aggregates: measures,
    groups: collectGroupKeys(tree).length,
    totals: aggregate(input.shown, measures),
    topGroups: top.slice(0, SUMMARY_GROUPS).map((node) => ({
      [node.field]: groupValue(node.value),
      rows: node.count,
      ...node.aggregates,
    })),
    moreGroups: Math.max(0, top.length - SUMMARY_GROUPS),
  };
}
