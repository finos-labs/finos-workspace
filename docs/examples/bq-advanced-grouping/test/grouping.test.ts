import { describe, expect, it } from "vitest";
import type { CompanyRow } from "../src/types";
import {
  aggregate,
  buildGroupTree,
  collectGroupKeys,
  flattenTree,
  type GroupNode,
} from "../src/grouping";

const row = (overrides: Partial<CompanyRow>): CompanyRow => ({
  id: "1",
  company: "Acme",
  sector: "Energy",
  industry: "Utilities",
  state: "TX",
  size: "Small",
  revenueUsdM: 10,
  employees: 100,
  foundedYear: 2000,
  ...overrides,
});

const rows: CompanyRow[] = [
  row({ id: "1", sector: "Energy", state: "TX", revenueUsdM: 10, employees: 100 }),
  row({ id: "2", sector: "Energy", state: "CA", revenueUsdM: 30, employees: 300 }),
  row({ id: "3", sector: "Energy", state: "TX", revenueUsdM: 20, employees: 200 }),
  row({ id: "4", sector: "Finance", state: "NY", revenueUsdM: 5, employees: 50 }),
];

describe("aggregate", () => {
  it.each([
    ["sum", 60],
    ["avg", 20],
    ["min", 10],
    ["max", 30],
  ] as const)("%s", (fn, expected) => {
    expect(aggregate(rows.slice(0, 3), ["revenueUsdM"], fn).revenueUsdM).toBe(expected);
  });

  it("returns null for an empty group", () => {
    expect(aggregate([], ["employees"], "sum").employees).toBeNull();
  });
});

describe("buildGroupTree", () => {
  it("groups by several columns with counts and aggregates at every level", () => {
    const tree = buildGroupTree(rows, ["sector", "state"], ["revenueUsdM"], "sum");
    const energy = tree[0] as GroupNode;

    expect(tree.map((node) => node.kind === "group" && node.value)).toEqual([
      "Energy",
      "Finance",
    ]);
    expect(energy.count).toBe(3);
    expect(energy.aggregates.revenueUsdM).toBe(60);
    expect(energy.children.map((child) => child.kind === "group" && child.value)).toEqual(
      ["CA", "TX"],
    );
    const texas = energy.children[1] as GroupNode;
    expect(texas.key).toBe("sector=Energy|state=TX");
    expect(texas.aggregates.revenueUsdM).toBe(30);
    expect(texas.children.map((child) => child.kind)).toEqual(["leaf", "leaf"]);
  });

  it("computes averages from leaf rows, not from child averages", () => {
    const [energy] = buildGroupTree(rows, ["sector", "state"], ["revenueUsdM"], "avg");
    expect((energy as GroupNode).aggregates.revenueUsdM).toBe(20);
  });

  it("returns plain leaves when there is no grouping", () => {
    const tree = buildGroupTree(rows, [], ["revenueUsdM"], "sum");
    expect(tree.every((node) => node.kind === "leaf")).toBe(true);
  });
});

describe("flattenTree", () => {
  const tree = buildGroupTree(rows, ["sector", "state"], ["revenueUsdM"], "sum");

  it("shows only top-level groups when nothing is expanded", () => {
    expect(flattenTree(tree, new Set()).map((r) => r.key)).toEqual([
      "sector=Energy",
      "sector=Finance",
    ]);
  });

  it("shows children of expanded groups only", () => {
    const visible = flattenTree(
      tree,
      new Set(["sector=Energy", "sector=Energy|state=TX"]),
    );
    expect(visible.map((r) => r.key)).toEqual([
      "sector=Energy",
      "sector=Energy|state=CA",
      "sector=Energy|state=TX",
      "row:1",
      "row:3",
      "sector=Finance",
    ]);
  });

  it("expands everything with collectGroupKeys", () => {
    const visible = flattenTree(tree, new Set(collectGroupKeys(tree)));
    expect(visible.filter((r) => r.kind === "leaf")).toHaveLength(rows.length);
  });
});
