import { describe, it, expect } from "bun:test";
import { clipForModel } from "../../../../src/agent/clip";

describe("clipForModel", () => {
  it("leaves a text that fits as it is", () => {
    expect(clipForModel("abc", 10)).toBe("abc");
    expect(clipForModel("x".repeat(10), 10)).toBe("x".repeat(10));
  });

  it("cuts a longer text and says how much was not given", () => {
    const out = clipForModel("x".repeat(1_005), 1_000);
    expect(out.startsWith("x".repeat(1_000))).toBe(true);
    expect(out).toContain("5 more characters are not shown");
    expect(out.length).toBeLessThan(1_100);
  });

  it("adds how to get the rest", () => {
    expect(clipForModel("x".repeat(20), 10, "search it")).toContain("not shown; search it]");
  });
});
