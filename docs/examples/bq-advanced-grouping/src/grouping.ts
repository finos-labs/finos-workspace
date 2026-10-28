import type { Aggregation, CompanyRow, GroupField, Measure } from "./types";

export type Aggregates = Record<Measure, number | null>;

export interface GroupNode {
  kind: "group";
  /** Stable id built from the group path, e.g. "sector=Energy|state=TX". */
  key: string;
  level: number;
  field: GroupField;
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
  row: CompanyRow;
}

export type TreeNode = GroupNode | LeafNode;

/** A row ready for the grid: groups without their children. */
export type DisplayRow = Omit<GroupNode, "children"> | LeafNode;

export function aggregate(
  rows: readonly CompanyRow[],
  measures: readonly Measure[],
  fn: Aggregation,
): Aggregates {
  const result = {} as Aggregates;
  for (const measure of measures) {
    if (rows.length === 0) {
      result[measure] = null;
      continue;
    }
    const values = rows.map((row) => row[measure]);
    switch (fn) {
      case "sum":
        result[measure] = values.reduce((total, value) => total + value, 0);
        break;
      case "avg":
        result[measure] =
          values.reduce((total, value) => total + value, 0) / values.length;
        break;
      case "min":
        result[measure] = Math.min(...values);
        break;
      case "max":
        result[measure] = Math.max(...values);
        break;
    }
  }
  return result;
}

/**
 * Builds a multi-level group tree. Groups are ordered by value; leaves keep
 * their input order. Aggregates are computed from leaf rows at every level,
 * so averages are true averages rather than averages of averages.
 */
export function buildGroupTree(
  rows: readonly CompanyRow[],
  groupBy: readonly GroupField[],
  measures: readonly Measure[],
  fn: Aggregation,
): TreeNode[] {
  const build = (
    subset: readonly CompanyRow[],
    level: number,
    parentKey: string,
  ): TreeNode[] => {
    const field = groupBy[level];
    if (field === undefined) {
      return subset.map((row) => ({ kind: "leaf", key: `row:${row.id}`, level, row }));
    }

    const buckets = new Map<string, CompanyRow[]>();
    for (const row of subset) {
      const value = row[field];
      const bucket = buckets.get(value);
      if (bucket) bucket.push(row);
      else buckets.set(value, [row]);
    }

    return [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([value, bucket]) => {
        const key = `${parentKey}${parentKey ? "|" : ""}${field}=${value}`;
        return {
          kind: "group",
          key,
          level,
          field,
          value,
          count: bucket.length,
          aggregates: aggregate(bucket, measures, fn),
          children: build(bucket, level + 1, key),
        } satisfies GroupNode;
      });
  };

  return build(rows, 0, "");
}

/** Depth-first list of the rows the grid should show, honouring expanded groups. */
export function flattenTree(
  nodes: readonly TreeNode[],
  expanded: ReadonlySet<string>,
): DisplayRow[] {
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
