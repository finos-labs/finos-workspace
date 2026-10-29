import { describe, expect, it } from "vitest";
import type { ColumnSpec } from "../src/spec";
import { formatterOf, measuresOf, quickMatch, rowsCsv, stateOf, summary } from "../src/view-state";

const ROWS = [
  { company: "Acme", sector: "Energy", state: "TX", revenue: 10, employees: 100 },
  { company: "Bolt, Inc", sector: "Energy", state: "CA", revenue: 30, employees: 300 },
  { company: "Cobalt", sector: "Technology", state: "TX", revenue: 5, employees: 50 },
];
const FIELDS = ["company", "sector", "state", "revenue", "employees"];
const COLUMNS: ColumnSpec[] = FIELDS.map((field) => ({
  field,
  cellDataType: ["revenue", "employees"].includes(field) ? "number" : "text",
}));
const MEASURES = [
  { field: "revenue", aggFunc: "sum" as const },
  { field: "employees", aggFunc: "avg" as const },
];

describe("quickMatch", () => {
  it("keeps rows that have every word in some cell, as AG Grid's quick filter does", () => {
    expect(quickMatch(ROWS, FIELDS, "tx").map((r) => r.company)).toEqual(["Acme", "Cobalt"]);
    expect(quickMatch(ROWS, FIELDS, "energy  tx").map((r) => r.company)).toEqual(["Acme"]);
    expect(quickMatch(ROWS, FIELDS, "300").map((r) => r.company)).toEqual(["Bolt, Inc"]);
    expect(quickMatch(ROWS, FIELDS, " ")).toEqual(ROWS);
  });
});

describe("measuresOf", () => {
  it("keeps each column's function, or applies the view's to all", () => {
    expect(measuresOf(MEASURES, null)).toEqual(MEASURES);
    expect(measuresOf(MEASURES, "max").map((m) => m.aggFunc)).toEqual(["max", "max"]);
  });
});

describe("formatterOf", () => {
  it("formats numbers, currencies, percents and dates in the locale", () => {
    expect(formatterOf({ style: "decimal", decimals: 1 }, "en-US")(1234.56)).toBe("1,234.6");
    expect(formatterOf({ style: "currency", currency: "EUR", decimals: 0 }, "de-DE")(1234)).toBe("1.234 €");
    expect(formatterOf({ style: "percent" }, "en-US")(0.25)).toBe("25%");
    expect(formatterOf({ style: "decimal", notation: "compact" }, "en-US")(1_500_000)).toBe("1.5M");
    expect(formatterOf({ style: "date", dateStyle: "medium" }, "en-US")("2024-01-31")).toBe("Jan 31, 2024");
  });

  it("shows what it cannot format as it came", () => {
    expect(formatterOf({ style: "decimal" }, "en-US")("n/a")).toBe("n/a");
    expect(formatterOf({ style: "date" }, "en-US")("someday")).toBe("someday");
    expect(formatterOf({ style: "decimal" }, "en-US")(null)).toBe("");
  });
});

describe("rowsCsv", () => {
  it("writes every row and column, quoting where needed", () => {
    expect(rowsCsv(ROWS.slice(0, 2), COLUMNS)).toBe(
      [
        "Company,Sector,State,Revenue,Employees",
        "Acme,Energy,TX,10,100",
        '"Bolt, Inc",Energy,CA,30,300',
      ].join("\n"),
    );
  });
});

describe("stateOf", () => {
  it("keeps what this version saves, and only AG Grid's state it restores", () => {
    expect(
      stateOf({
        grid: { sort: { sortModel: [] }, scroll: { top: 10 }, columnOrder: { orderedColIds: ["a"] } },
        groupBy: ["sector", 3],
        aggFunc: "avg",
        search: "x",
        pivotMode: true,
        pivotBy: ["state", null],
        other: true,
      }),
    ).toEqual({
      grid: { sort: { sortModel: [] }, columnOrder: { orderedColIds: ["a"] } },
      groupBy: ["sector"],
      aggFunc: "avg",
      search: "x",
      pivotMode: true,
      pivotBy: ["state"],
    });
    expect(stateOf(null)).toEqual({});
    expect(stateOf({ aggFunc: "median" })).toEqual({});
  });
});

describe("summary", () => {
  const base = { columns: COLUMNS, measures: MEASURES, rows: ROWS };

  it("gives the agent the columns, counts, sort, filters and first rows", () => {
    const context = summary({
      ...base,
      shown: ROWS.slice(0, 1),
      view: { groupBy: [], aggFunc: null, search: "acme", pivotMode: false, pivotBy: [] },
      sort: { sortModel: [{ colId: "revenue", sort: "desc" }] },
    });
    expect(context).toMatchObject({
      rows: 3,
      shown: 1,
      search: "acme",
      sort: { sortModel: [{ colId: "revenue", sort: "desc" }] },
      filter: null,
      firstRows: [ROWS[0]],
    });
    expect(context.columns[3]).toEqual({ field: "revenue", header: "Revenue", type: "number" });
  });

  it("gives the top-level groups when grouped, with each column's function", () => {
    expect(summary({ ...base, shown: ROWS, view: { groupBy: ["sector"], aggFunc: null, search: "", pivotMode: false, pivotBy: [] } })).toMatchObject({
      groupBy: ["sector"],
      groups: 2,
      totals: { revenue: 45, employees: 150 },
      topGroups: [
        { sector: "Energy", rows: 2, revenue: 40, employees: 200 },
        { sector: "Technology", rows: 1, revenue: 5, employees: 50 },
      ],
      moreGroups: 0,
    });
  });

  it("gives the pivot's rows with their cells named, and the totals, when pivoted", () => {
    const view = { groupBy: ["sector"], aggFunc: "sum" as const, search: "", pivotMode: true, pivotBy: ["state"] };
    expect(summary({ ...base, shown: ROWS, view, sort: { sortModel: [] } })).toMatchObject({
      sort: null,
      pivot: { rows: ["sector"], columns: ["state"], columnKeys: 2, columnKeysNotShown: 0 },
      pivotRows: 2,
      firstPivotRows: [
        { sector: "Energy", "CA · revenue (sum)": 30, "TX · revenue (sum)": 10, "Total · revenue (sum)": 40 },
        { sector: "Technology", "CA · revenue (sum)": null, "TX · revenue (sum)": 5 },
      ],
      totals: { sector: "Total", "Total · employees (sum)": 450 },
    });
  });
});
