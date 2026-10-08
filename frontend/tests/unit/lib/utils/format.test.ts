import { describe, expect, it } from "vitest";
import { convertToReadableLabel, formatDate, isDate } from "~/lib/utils/format";

describe("isDate", () => {
  it("returns true for valid date string in ISO format", () => {
    expect(isDate("2024-01-15")).toBe(true);
  });

  it("returns false for invalid date string", () => {
    expect(isDate("not-a-date")).toBe(false);
  });

  it("returns false for number", () => {
    expect(isDate(12345)).toBe(false);
  });

  it("returns false for null", () => {
    expect(isDate(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isDate(undefined)).toBe(false);
  });
});

describe("formatDate", () => {
  it("formats date with default template", () => {
    const result = formatDate("2024-01-15");
    expect(result).toBe("2024-01-15");
  });

  it("formats date with custom template", () => {
    const result = formatDate("2024-01-15", "MMM D, YYYY");
    expect(result).toBe("Jan 15, 2024");
  });

  it("handles Date object", () => {
    const result = formatDate(new Date("2024-01-15"));
    expect(result).toBe("2024-01-15");
  });
});

describe("convertToReadableLabel", () => {
  it("converts snake_case to Title Case", () => {
    expect(convertToReadableLabel("market_cap")).toBe("Market Cap");
  });

  it("converts camelCase to Title Case", () => {
    expect(convertToReadableLabel("marketCap")).toBe("Market Cap");
  });

  it("handles single word", () => {
    expect(convertToReadableLabel("price")).toBe("Price");
  });

  it("handles all caps abbreviations", () => {
    expect(convertToReadableLabel("EPS")).toBe("EPS");
  });

  it("handles multiple underscores", () => {
    expect(convertToReadableLabel("price_to_earnings_ratio")).toBe(
      "Price To Earnings Ratio",
    );
  });
});
