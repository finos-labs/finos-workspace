/**
 * The rows the host pushes into the `data` trait, and what is made from them outside the
 * grid: search, the CSV export and the agent's summary. Pure functions, tested without a
 * browser.
 *
 * Workspace fetches the widget's endpoint and pushes the response; the frame has no
 * network. The endpoint returns `{ rows: CompanyRow[], total }` (the companies backend)
 * or the rows as an array.
 */
import { aggregate, buildGroupTree, collectGroupKeys, type TreeNode } from "./grouping";
import {
  type Aggregation,
  COMPANY_SIZES,
  type CompanyRow,
  FIELD_LABELS,
  type GroupField,
  MEASURES,
} from "./types";

function isCompanyRow(value: unknown): value is CompanyRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.company === "string" &&
    typeof row.sector === "string" &&
    typeof row.industry === "string" &&
    typeof row.state === "string" &&
    (COMPANY_SIZES as readonly unknown[]).includes(row.size) &&
    typeof row.revenueUsdM === "number" &&
    typeof row.employees === "number" &&
    typeof row.foundedYear === "number"
  );
}

export type Parsed =
  | { ok: true; rows: CompanyRow[] }
  | { ok: false; message: string };

/** The company rows in a response, or why there are none. */
export function rowsOf(response: unknown): Parsed {
  const list = Array.isArray(response)
    ? response
    : typeof response === "object" && response !== null && Array.isArray((response as { rows?: unknown }).rows)
      ? (response as { rows: unknown[] }).rows
      : null;
  if (list === null) {
    return { ok: false, message: "The endpoint did not return company rows." };
  }
  if (!list.every(isCompanyRow)) {
    return { ok: false, message: "The endpoint returned rows in an unexpected format." };
  }
  return { ok: true, rows: list };
}

const TEXT_FIELDS = ["company", "sector", "industry", "state", "size"] as const;

/** Case-insensitive search over the text columns, as the companies backend searched. */
export function searchRows(rows: readonly CompanyRow[], search: string): CompanyRow[] {
  const needle = search.trim().toLowerCase();
  if (!needle) return [...rows];
  return rows.filter((row) =>
    TEXT_FIELDS.some((field) => row[field].toLowerCase().includes(needle)),
  );
}

/** What the user has chosen in the view; the exports and the agent read it. */
export interface ViewState {
  groupBy: GroupField[];
  aggregation: Aggregation;
  search: string;
}

function quote(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const LEAF_COLUMNS = [
  "company",
  "sector",
  "industry",
  "state",
  "size",
  "revenueUsdM",
  "employees",
  "foundedYear",
] as const;

/** The rows the search keeps, one line per company. */
export function rowsCsv(rows: readonly CompanyRow[]): string {
  const header = LEAF_COLUMNS.map((column) => FIELD_LABELS[column]);
  const lines = rows.map((row) => LEAF_COLUMNS.map((column) => row[column]));
  return [header, ...lines].map((line) => line.map(quote).join(",")).join("\n");
}

/** One line per group at every level, with its path, count and aggregates. */
export function groupsCsv(
  rows: readonly CompanyRow[],
  view: ViewState,
): string | null {
  if (!view.groupBy.length) return null;
  const tree = buildGroupTree(rows, view.groupBy, MEASURES, view.aggregation);
  const header = [
    ...view.groupBy.map((field) => FIELD_LABELS[field]),
    "Companies",
    ...MEASURES.map((measure) => `${FIELD_LABELS[measure]} (${view.aggregation})`),
  ];
  const lines: unknown[][] = [];
  const walk = (nodes: readonly TreeNode[], path: string[]) => {
    for (const node of nodes) {
      if (node.kind !== "group") continue;
      const here = [...path, node.value];
      const cells = view.groupBy.map((_, i) => here[i] ?? "");
      lines.push([...cells, node.count, ...MEASURES.map((m) => node.aggregates[m])]);
      walk(node.children, here);
    }
  };
  walk(tree, []);
  return [header, ...lines].map((line) => line.map(quote).join(",")).join("\n");
}

/** Up to this many top-level groups go to the agent. */
const SUMMARY_GROUPS = 20;

/**
 * What the agent is told: the view's choices, how many companies the search keeps, the
 * totals, and the top-level groups with their counts and aggregates. Not the rows.
 */
export function summary(rows: readonly CompanyRow[], view: ViewState) {
  const matching = searchRows(rows, view.search);
  const tree = buildGroupTree(matching, view.groupBy, MEASURES, view.aggregation);
  const topGroups = tree.filter((node) => node.kind === "group");
  return {
    groupBy: view.groupBy,
    aggregation: view.aggregation,
    search: view.search || null,
    companies: matching.length,
    groups: collectGroupKeys(tree).length,
    totals: aggregate(matching, MEASURES, view.aggregation),
    topGroups: topGroups.slice(0, SUMMARY_GROUPS).map((node) => ({
      [FIELD_LABELS[node.field]]: node.value,
      companies: node.count,
      ...node.aggregates,
    })),
    moreGroups: Math.max(0, topGroups.length - SUMMARY_GROUPS),
  };
}
