import { describe, expect, it } from "vitest";
import { rowsOf } from "~/lib/utils/rawRows";

describe("rowsOf", () => {
  const records = [{ month: "Jan", a: 43 }];

  it("reads the rows at data.rawDataKey", () => {
    expect(rowsOf({ results: { chart: {}, records } }, "results.records")).toEqual(
      records,
    );
  });

  it("reads results without a key, as html widgets always have", () => {
    expect(rowsOf({ results: records })).toEqual(records);
  });

  it("takes the whole response when it has neither", () => {
    expect(rowsOf(records)).toEqual(records);
    expect(rowsOf({ rows: records })).toEqual({ rows: records });
  });

  it("falls back to the whole response when the key is missing, as dataKey does", () => {
    expect(rowsOf({ rows: records }, "results.records")).toEqual({ rows: records });
  });
});
