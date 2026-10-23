import { describe, it, afterEach } from "node:test";
import { expect } from "expect";
import { parseJsonResponse, truncate } from "../../../../src/lib/llm.ts";

describe("singleShotLlm model choice", () => {
  // No model id is baked in: with no caller model and no DEFAULT_MODEL it fails
  // loudly. A fresh copy of the module is loaded because other test files mock lib/llm.
  const saved = process.env.DEFAULT_MODEL;
  afterEach(() => {
    if (saved === undefined) delete process.env.DEFAULT_MODEL;
    else process.env.DEFAULT_MODEL = saved;
  });

  it("fails with a clear message when no model is configured", async () => {
    delete process.env.DEFAULT_MODEL;
    const real = await import(`../../../../src/lib/llm.ts?real=${crypto.randomUUID()}`);
    await expect(real.singleShotLlm("hi")).rejects.toThrow("No model configured");
  });
});

describe("parseJsonResponse", () => {
  it("parses bare JSON", () => {
    expect(parseJsonResponse('{"a":1}', { a: 0 })).toEqual({ a: 1 });
  });

  it("strips ```json fenced blocks before parsing", () => {
    expect(parseJsonResponse('```json\n{"a":2}\n```', { a: 0 })).toEqual({ a: 2 });
  });

  it("returns the fallback when JSON is malformed", () => {
    expect(parseJsonResponse("not json", { fallback: true })).toEqual({ fallback: true });
  });

  it("returns the fallback on empty string", () => {
    expect(parseJsonResponse("", { x: 1 })).toEqual({ x: 1 });
  });
});

describe("truncate", () => {
  it("returns the input unchanged when shorter than max", () => {
    expect(truncate("short", 10)).toBe("short");
  });

  it("returns the input unchanged at exact max length", () => {
    expect(truncate("12345", 5)).toBe("12345");
  });

  it("appends an ellipsis when truncated", () => {
    expect(truncate("123456", 3)).toBe("123...");
  });
});
