import { describe, it } from "node:test";
import { expect } from "expect";
import { sanitizeName, analyzeTable } from "../../../../src/sql/loader.ts";

describe("sanitizeName", () => {
  it("lowercases the input", () => {
    expect(sanitizeName("PRICES")).toBe("prices");
  });

  it("replaces non-identifier characters with underscores", () => {
    expect(sanitizeName("foo-bar.baz")).toBe("foo_bar_baz");
    expect(sanitizeName("revenue ($)")).toBe("revenue____");
  });

  it("prefixes col_ when the name starts with a digit", () => {
    expect(sanitizeName("1_year")).toBe("col_1_year");
    expect(sanitizeName("2024 q1")).toBe("col_2024_q1");
  });
});

describe("analyzeTable", () => {
  it("derives column names + types from the first row", () => {
    const t = analyzeTable("Prices", [{ symbol: "NVDA", close: 100 }]);
    expect(t.tableName).toBe("prices");
    expect(t.rowCount).toBe(1);
    expect(t.columns).toEqual([
      { name: "symbol", originalName: "symbol", type: "TEXT" },
      { name: "close", originalName: "close", type: "INTEGER" },
    ]);
  });

  it("infers REAL when a number is non-integer", () => {
    const t = analyzeTable("p", [{ x: 1.5 }]);
    expect(t.columns[0].type).toBe("REAL");
  });

  it("infers INTEGER when values are booleans", () => {
    const t = analyzeTable("p", [{ flag: true }]);
    expect(t.columns[0].type).toBe("INTEGER");
  });

  it("falls back to TEXT for non-primitive values or all-null columns", () => {
    const t = analyzeTable("p", [{ a: { complex: 1 }, b: null }]);
    expect(t.columns[0].type).toBe("TEXT");
    expect(t.columns[1].type).toBe("TEXT");
  });

  it("regression: type-infers a column whose first non-null value is past row 50 (sparse columns)", () => {
    const rows = Array.from({ length: 200 }, (_, i) =>
      i === 60 ? { x: 5 } : { x: null },
    );
    expect(analyzeTable("p", rows).columns[0].type).toBe("INTEGER");
  });

  it("regression: dedupes columns that sanitize to the same name (case-only / separator-only collisions)", () => {
    const t = analyzeTable("p", [{ a: 1, A: 2, "foo bar": 3, "foo-bar": 4 }]);
    const names = t.columns.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(["a", "a_2", "foo_bar", "foo_bar_2"]);
    expect(t.columns.map((c) => c.originalName)).toEqual(["a", "A", "foo bar", "foo-bar"]);
  });

  it("documented limit: rows beyond the 500-row cap can still fall back to TEXT", () => {
    const rows = Array.from({ length: 600 }, (_, i) =>
      i === 599 ? { x: 5 } : { x: null },
    );
    expect(analyzeTable("p", rows).columns[0].type).toBe("TEXT");
  });

  it("preserves originalName even when sanitized differs", () => {
    const t = analyzeTable("My Table", [{ "Total ($)": 1 }]);
    expect(t.tableName).toBe("my_table");
    expect(t.columns[0].originalName).toBe("Total ($)");
    expect(t.columns[0].name).not.toContain(" ");
  });

  it("falls back tableName to 'data' when sanitization yields empty string", () => {
    expect(analyzeTable("", [{ a: 1 }]).tableName).toBe("data");
  });

  it("returns rowCount = 0 with no columns when input is empty", () => {
    const t = analyzeTable("x", []);
    expect(t.rowCount).toBe(0);
    expect(t.columns).toEqual([]);
  });
});
