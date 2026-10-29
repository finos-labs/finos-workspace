import { describe, expect, it } from "vitest";
import { BLANK } from "../src/grouping";
import { LABEL_FIELD, MAX_PIVOT_KEYS, pivotField, pivotLabel, pivotTable, totalField } from "../src/pivot";

const ROWS = [
  { sector: "Energy", size: "Large", year: 2024, revenue: 10, employees: 100 },
  { sector: "Energy", size: "Small", year: 2024, revenue: 30, employees: 300 },
  { sector: "Energy", size: "Large", year: 2025, revenue: 20, employees: 200 },
  { sector: "Technology", size: "Small", year: 2025, revenue: 5, employees: 50 },
  { sector: null, size: "Small", year: 2025, revenue: 1, employees: 10 },
];
const SUM = [{ field: "revenue", aggFunc: "sum" as const }];

describe("pivotTable", () => {
  it("makes a row per row value and a cell per pivot value, with totals", () => {
    const table = pivotTable(ROWS, ["sector"], ["size"], SUM);
    expect(table.keys).toEqual([["Large"], ["Small"]]);
    expect(table.rows.map((row) => row.sector)).toEqual(["Energy", "Technology", BLANK]);
    expect(table.rows[0]).toMatchObject({ [pivotField(0, 0)]: 30, [pivotField(1, 0)]: 30, [totalField(0)]: 60 });
    // No Large technology company: no cell
    expect(table.rows[1]?.[pivotField(0, 0)]).toBeUndefined();
    expect(table.rows[1]?.[pivotField(1, 0)]).toBe(5);
    expect(table.totals).toMatchObject({ sector: "Total", [pivotField(0, 0)]: 30, [pivotField(1, 0)]: 36, [totalField(0)]: 66 });
  });

  it("nests pivot columns and keeps a cell per measure", () => {
    const measures = [...SUM, { field: "employees", aggFunc: "avg" as const }];
    const table = pivotTable(ROWS, ["sector"], ["size", "year"], measures);
    expect(table.keys).toEqual([
      ["Large", "2024"],
      ["Large", "2025"],
      ["Small", "2024"],
      ["Small", "2025"],
    ]);
    expect(table.rows[0]).toMatchObject({ [pivotField(1, 0)]: 20, [pivotField(1, 1)]: 200, [totalField(1)]: 200 });
  });

  it("counts rows without measures, and is one row without row columns", () => {
    const table = pivotTable(ROWS, [], ["size"], []);
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]).toMatchObject({ [LABEL_FIELD]: "Total", [pivotField(0, 0)]: 2, [pivotField(1, 0)]: 3, [totalField(0)]: 5 });
  });

  it("has only totals without pivot columns", () => {
    const table = pivotTable(ROWS, ["size"], [], SUM);
    expect(table.keys).toEqual([]);
    expect(table.rows.map((row) => [row.size, row[totalField(0)]])).toEqual([
      ["Large", 30],
      ["Small", 36],
    ]);
  });

  it("keeps the first pivot keys, and the totals of every row", () => {
    const rows = Array.from({ length: MAX_PIVOT_KEYS + 5 }, (_, index) => ({ id: index, revenue: 1 }));
    const table = pivotTable(rows, [], ["id"], SUM);
    expect(table.keys).toHaveLength(MAX_PIVOT_KEYS);
    expect(table.hidden).toBe(5);
    expect(table.totals[totalField(0)]).toBe(MAX_PIVOT_KEYS + 5);
  });
});

describe("pivotLabel", () => {
  it("names a cell by its values and measure", () => {
    expect(pivotLabel(["Large", "2024"], SUM[0])).toBe("Large / 2024 · revenue (sum)");
    expect(pivotLabel(null, undefined)).toBe("Total · rows");
  });
});
