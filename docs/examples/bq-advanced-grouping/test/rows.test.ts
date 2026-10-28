import { describe, expect, it } from "vitest";
import { groupsCsv, rowsCsv, rowsOf, searchRows, summary } from "../src/rows";
import type { CompanyRow } from "../src/types";

const row = (overrides: Partial<CompanyRow>): CompanyRow => ({
  id: "1",
  company: "Acme",
  sector: "Energy",
  industry: "Oil & Gas",
  state: "TX",
  size: "Small",
  revenueUsdM: 10,
  employees: 100,
  foundedYear: 2000,
  ...overrides,
});

const ROWS = [
  row({ id: "1", company: "Acme", sector: "Energy", state: "TX", revenueUsdM: 10, employees: 100 }),
  row({ id: "2", company: "Bolt, Inc", sector: "Energy", state: "CA", revenueUsdM: 30, employees: 300 }),
  row({ id: "3", company: "Cobalt", sector: "Technology", industry: "Software", state: "TX", revenueUsdM: 5, employees: 50 }),
];

describe("rowsOf", () => {
  it("reads the companies backend's page and a plain array", () => {
    expect(rowsOf({ rows: ROWS, total: 3 })).toEqual({ ok: true, rows: ROWS });
    expect(rowsOf(ROWS)).toEqual({ ok: true, rows: ROWS });
  });

  it("refuses what is not company rows", () => {
    expect(rowsOf({ data: [] })).toMatchObject({ ok: false });
    expect(rowsOf("rows")).toMatchObject({ ok: false });
    expect(rowsOf([{ ...ROWS[0], size: "Huge" }])).toMatchObject({
      ok: false,
      message: "The endpoint returned rows in an unexpected format.",
    });
  });
});

describe("searchRows", () => {
  it("matches the text columns, case-insensitive", () => {
    expect(searchRows(ROWS, "software").map((r) => r.id)).toEqual(["3"]);
    expect(searchRows(ROWS, " tx ").map((r) => r.id)).toEqual(["1", "3"]);
    expect(searchRows(ROWS, "")).toEqual(ROWS);
  });
});

describe("exports", () => {
  it("writes one line per company, quoting where needed", () => {
    expect(rowsCsv(ROWS.slice(0, 2))).toBe(
      [
        "Company,Sector,Industry,State,Size,Revenue ($M),Employees,Founded",
        "Acme,Energy,Oil & Gas,TX,Small,10,100,2000",
        '"Bolt, Inc",Energy,Oil & Gas,CA,Small,30,300,2000',
      ].join("\n"),
    );
  });

  it("writes one line per group at every level", () => {
    expect(groupsCsv(ROWS, { groupBy: ["sector", "state"], aggregation: "sum", search: "" })).toBe(
      [
        "Sector,State,Companies,Revenue ($M) (sum),Employees (sum)",
        "Energy,,2,40,400",
        "Energy,CA,1,30,300",
        "Energy,TX,1,10,100",
        "Technology,,1,5,50",
        "Technology,TX,1,5,50",
      ].join("\n"),
    );
    expect(groupsCsv(ROWS, { groupBy: [], aggregation: "sum", search: "" })).toBeNull();
  });
});

describe("summary", () => {
  it("gives the agent the view, totals and top-level groups, not the rows", () => {
    expect(summary(ROWS, { groupBy: ["sector"], aggregation: "avg", search: "" })).toEqual({
      groupBy: ["sector"],
      aggregation: "avg",
      search: null,
      companies: 3,
      groups: 2,
      totals: { revenueUsdM: 15, employees: 150 },
      topGroups: [
        { Sector: "Energy", companies: 2, revenueUsdM: 20, employees: 200 },
        { Sector: "Technology", companies: 1, revenueUsdM: 5, employees: 50 },
      ],
      moreGroups: 0,
    });
  });

  it("follows the search", () => {
    expect(summary(ROWS, { groupBy: [], aggregation: "sum", search: "tx" })).toMatchObject({
      search: "tx",
      companies: 2,
      groups: 0,
      totals: { revenueUsdM: 15, employees: 150 },
    });
  });
});
