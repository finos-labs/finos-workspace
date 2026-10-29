import type { AggFunc, Row } from "./spec";

/** A column aggregated on group rows, and how. */
export interface Measure {
  field: string;
  aggFunc: AggFunc;
}

export type Aggregates = Record<string, number | null>;

export interface GroupNode {
  kind: "group";
  /** Stable id built from the group path, e.g. "sector=Energy|state=TX". */
  key: string;
  level: number;
  field: string;
  value: string;
  /** Number of leaf rows under this group. */
  count: number;
  aggregates: Aggregates;
  children: TreeNode[];
}

export interface LeafNode {
  kind: "leaf";
  key: string;
  level: number;
  row: Row;
}

export type TreeNode = GroupNode | LeafNode;

/** A row ready for the grid: groups without their children. */
export type DisplayRow = Omit<GroupNode, "children"> | LeafNode;

/** The label of rows that have no value in a grouped column. */
export const BLANK = "(blank)";

export function groupValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return BLANK;
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function aggregate(rows: readonly Row[], measures: readonly Measure[]): Aggregates {
  const result: Aggregates = {};
  for (const { field, aggFunc } of measures) {
    const values = rows
      .map((row) => row[field])
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    if (aggFunc === "count") {
      result[field] = values.length;
      continue;
    }
    if (values.length === 0) {
      result[field] = null;
      continue;
    }
    switch (aggFunc) {
      case "sum":
        result[field] = values.reduce((total, value) => total + value, 0);
        break;
      case "avg":
        result[field] = values.reduce((total, value) => total + value, 0) / values.length;
        break;
      case "min":
        result[field] = Math.min(...values);
        break;
      case "max":
        result[field] = Math.max(...values);
        break;
    }
  }
  return result;
}

/**
 * Builds a multi-level group tree. Groups are ordered by value, blanks last; leaves keep
 * their input order. Aggregates are computed from leaf rows at every level, so averages
 * are true averages rather than averages of averages.
 */
export function buildGroupTree(
  rows: readonly Row[],
  groupBy: readonly string[],
  measures: readonly Measure[],
): TreeNode[] {
  const indexOf = new Map(rows.map((row, index) => [row, index]));
  const build = (subset: readonly Row[], level: number, parentKey: string): TreeNode[] => {
    const field = groupBy[level];
    if (field === undefined) {
      return subset.map((row) => ({ kind: "leaf", key: `row:${indexOf.get(row)}`, level, row }));
    }

    const buckets = new Map<string, Row[]>();
    for (const row of subset) {
      const value = groupValue(row[field]);
      const bucket = buckets.get(value);
      if (bucket) bucket.push(row);
      else buckets.set(value, [row]);
    }

    return [...buckets.entries()]
      .sort(([a], [b]) =>
        a === BLANK ? 1 : b === BLANK ? -1 : a.localeCompare(b, undefined, { numeric: true }),
      )
      .map(([value, bucket]) => {
        const key = `${parentKey}${parentKey ? "|" : ""}${field}=${value}`;
        return {
          kind: "group",
          key,
          level,
          field,
          value,
          count: bucket.length,
          aggregates: aggregate(bucket, measures),
          children: build(bucket, level + 1, key),
        } satisfies GroupNode;
      });
  };

  return build(rows, 0, "");
}

/** Depth-first list of the rows the grid should show, honouring expanded groups. */
export function flattenTree(nodes: readonly TreeNode[], expanded: ReadonlySet<string>): DisplayRow[] {
  const out: DisplayRow[] = [];
  const walk = (list: readonly TreeNode[]) => {
    for (const node of list) {
      if (node.kind === "leaf") {
        out.push(node);
        continue;
      }
      const { children, ...group } = node;
      out.push(group);
      if (expanded.has(node.key)) walk(children);
    }
  };
  walk(nodes);
  return out;
}

export function collectGroupKeys(nodes: readonly TreeNode[]): string[] {
  const keys: string[] = [];
  const walk = (list: readonly TreeNode[]) => {
    for (const node of list) {
      if (node.kind === "group") {
        keys.push(node.key);
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return keys;
}
