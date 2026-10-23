import { describe, it } from "node:test";
import { expect } from "expect";
import { _widgetCacheKey } from "../../../../src/agent/loop.ts";

describe("_widgetCacheKey — determinism", () => {
  it("regression: same uuid + same args → same key", () => {
    expect(_widgetCacheKey("u-1", { x: 1, y: 2 })).toBe(_widgetCacheKey("u-1", { x: 1, y: 2 }));
  });

  it("regression: key is invariant under args key-order", () => {
    expect(_widgetCacheKey("u-1", { x: 1, y: 2 })).toBe(_widgetCacheKey("u-1", { y: 2, x: 1 }));
  });

  it("regression: undefined args and {} produce the same key (no args == empty args)", () => {
    expect(_widgetCacheKey("u-1")).toBe(_widgetCacheKey("u-1", {}));
  });
});

describe("_widgetCacheKey — type-strictness (real bug class — string vs number)", () => {
  it('regression: `"47"` and `47` are different cache keys', () => {
    expect(_widgetCacheKey("u-1", { id: "47" })).not.toBe(_widgetCacheKey("u-1", { id: 47 }));
  });

  it("regression: `null` and `undefined` arg values are differentiated by JSON.stringify", () => {
    const withNull = _widgetCacheKey("u-1", { x: null });
    const withUndefined = _widgetCacheKey("u-1", { x: undefined });
    expect(withNull).not.toBe(withUndefined);
  });
});

describe("_widgetCacheKey — distinctness", () => {
  it("regression: different uuids produce different keys with the same args", () => {
    expect(_widgetCacheKey("u-1", { x: 1 })).not.toBe(_widgetCacheKey("u-2", { x: 1 }));
  });

  it("regression: different args produce different keys for the same uuid", () => {
    expect(_widgetCacheKey("u-1", { x: 1 })).not.toBe(_widgetCacheKey("u-1", { x: 2 }));
  });
});
