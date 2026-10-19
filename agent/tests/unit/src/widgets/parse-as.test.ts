import { describe, it, expect } from "bun:test";
import { readParseAs, routeForParseAs } from "../../../../src/widgets/parse-as";

describe("readParseAs", () => {
  it("returns the canonical lowercased value for valid kinds", () => {
    expect(readParseAs({ data_format: { parse_as: "TABLE" } })).toBe("table");
    expect(readParseAs({ data_format: { parse_as: "Chart" } })).toBe("chart");
    expect(readParseAs({ data_format: { parse_as: "text" } })).toBe("text");
    expect(readParseAs({ data_format: { parse_as: "html" } })).toBe("html");
  });

  it("returns null for unknown kinds", () => {
    expect(readParseAs({ data_format: { parse_as: "csv" } })).toBeNull();
    expect(readParseAs({ data_format: { parse_as: "" } })).toBeNull();
  });

  it("returns null when parse_as is missing or non-string", () => {
    expect(readParseAs({ data_format: {} })).toBeNull();
    expect(readParseAs({})).toBeNull();
    expect(readParseAs({ data_format: { parse_as: 42 } })).toBeNull();
  });
});

describe("routeForParseAs", () => {
  it("table and chart route to SQLite only", () => {
    expect(routeForParseAs("table")).toEqual({
      toSqlite: true,
      asText: false,
      brief: false,
    });
    expect(routeForParseAs("chart")).toEqual({
      toSqlite: true,
      asText: false,
      brief: false,
    });
  });

  it("text routes to plain text only", () => {
    expect(routeForParseAs("text")).toEqual({
      toSqlite: false,
      asText: true,
      brief: false,
    });
  });

  it("html routes to brief description", () => {
    expect(routeForParseAs("html")).toEqual({
      toSqlite: false,
      asText: false,
      brief: true,
    });
  });

  it("null falls back to dual SQLite + text route", () => {
    expect(routeForParseAs(null)).toEqual({
      toSqlite: true,
      asText: true,
      brief: false,
    });
  });
});
