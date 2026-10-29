import { describe, expect, it } from "vitest";
import {
  aggregate,
  BLANK,
  buildGroupTree,
  collectGroupKeys,
  flattenTree,
  type GroupNode,
  type Measure,
} from "../src/grouping";

const rows = [
  { sector: "Energy", state: "TX", revenue: 10, employees: 100 },
  { sector: "Energy", state: "CA", revenue: 30, employees: 300 },
  { sector: "Energy", state: "TX", revenue: 20, employees: 200 },
  { sector: "Finance", state: "NY", revenue: 5, employees: 50 },
];

const sum = (field: string): Measure => ({ field, aggFunc: "sum" });

describe("aggregate", () => {
  it.each([
    ["sum", 60],
    ["avg", 20],
    ["min", 10],
    ["max", 30],
    ["count", 3],
  ] as const)("%s", (aggFunc, expected) => {
    expect(aggregate(rows.slice(0, 3), [{ field: "revenue", aggFunc }]).revenue).toBe(expected);
  });

  it("applies each column's own function", () => {
    expect(
      aggregate(rows, [
        { field: "revenue", aggFunc: "max" },
        { field: "employees", aggFunc: "avg" },
      ]),
    ).toEqual({ revenue: 30, employees: 162.5 });
  });

  it("skips values that are not numbers, and returns null when there are none", () => {
    expect(aggregate([{ v: 1 }, { v: "2" }, { v: null }], [sum("v")]).v).toBe(1);
    expect(aggregate([], [sum("employees")]).employees).toBeNull();
    expect(aggregate([], [{ field: "employees", aggFunc: "count" }]).employees).toBe(0);
  });
});

describe("buildGroupTree", () => {
  it("groups by several columns with counts and aggregates at every level", () => {
    const tree = buildGroupTree(rows, ["sector", "state"], [sum("revenue")]);
    const energy = tree[0] as GroupNode;

    expect(tree.map((node) => node.kind === "group" && node.value)).toEqual(["Energy", "Finance"]);
    expect(energy.count).toBe(3);
    expect(energy.aggregates.revenue).toBe(60);
    expect(energy.children.map((child) => child.kind === "group" && child.value)).toEqual(["CA", "TX"]);
    const texas = energy.children[1] as GroupNode;
    expect(texas.key).toBe("sector=Energy|state=TX");
    expect(texas.aggregates.revenue).toBe(30);
    expect(texas.children.map((child) => child.kind)).toEqual(["leaf", "leaf"]);
  });

  it("computes averages from leaf rows, not from child averages", () => {
    const [energy] = buildGroupTree(rows, ["sector", "state"], [{ field: "revenue", aggFunc: "avg" }]);
    expect((energy as GroupNode).aggregates.revenue).toBe(20);
  });

  it("groups any value: numbers, booleans and blanks, blanks last", () => {
    const tree = buildGroupTree(
      [{ year: 2021 }, { year: null }, { year: 2020 }, { year: "" }, { public: true }],
      ["year"],
      [],
    );
    expect(tree.map((node) => node.kind === "group" && [node.value, node.count])).toEqual([
      ["2020", 1],
      ["2021", 1],
      [BLANK, 3],
    ]);
  });

  it("returns plain leaves when there is no grouping", () => {
    const tree = buildGroupTree(rows, [], [sum("revenue")]);
    expect(tree.every((node) => node.kind === "leaf")).toBe(true);
  });
});

describe("flattenTree", () => {
  const tree = buildGroupTree(rows, ["sector", "state"], [sum("revenue")]);

  it("shows only top-level groups when nothing is expanded", () => {
    expect(flattenTree(tree, new Set()).map((r) => r.key)).toEqual(["sector=Energy", "sector=Finance"]);
  });

  it("shows children of expanded groups only", () => {
    const visible = flattenTree(tree, new Set(["sector=Energy", "sector=Energy|state=TX"]));
    expect(visible.map((r) => r.key)).toEqual([
      "sector=Energy",
      "sector=Energy|state=CA",
      "sector=Energy|state=TX",
      "row:0",
      "row:2",
      "sector=Finance",
    ]);
  });

  it("expands everything with collectGroupKeys", () => {
    const visible = flattenTree(tree, new Set(collectGroupKeys(tree)));
    expect(visible.filter((r) => r.kind === "leaf")).toHaveLength(rows.length);
  });
});
