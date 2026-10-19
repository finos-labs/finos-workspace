import { describe, it, expect } from "bun:test";
import {
  flattenUsage,
  accumulateUsage,
  cacheHitRate,
  TokenUsageSchema,
  usageHiddenEvent,
  usageVisibleEvent,
  readTurnUsage,
  ZERO_TURN_USAGE,
  ZERO_USAGE_COUNTS,
} from "../../../../src/lib/token-usage";
import type { LanguageModelUsage } from "ai";

describe("flattenUsage", () => {
  it("treats missing fields as 0 and computes total", () => {
    const out = flattenUsage({} as LanguageModelUsage);
    expect(out).toEqual(ZERO_USAGE_COUNTS);
  });

  it("sums input + output regardless of provider's totalTokens", () => {
    const out = flattenUsage({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 999,
    } as LanguageModelUsage);
    expect(out).toEqual({
      inputTokens: 100,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 50,
      totalTokens: 150,
    });
  });

  it("reads cache reads/writes from inputTokenDetails", () => {
    const out = flattenUsage({
      inputTokens: 1000,
      outputTokens: 10,
      inputTokenDetails: { noCacheTokens: 200, cacheReadTokens: 750, cacheWriteTokens: 50 },
    } as LanguageModelUsage);
    expect(out.cachedInputTokens).toBe(750);
    expect(out.cacheWriteTokens).toBe(50);
  });

  it("falls back to the deprecated flat cachedInputTokens", () => {
    const out = flattenUsage({
      inputTokens: 1000,
      outputTokens: 10,
      cachedInputTokens: 600,
    } as LanguageModelUsage);
    expect(out.cachedInputTokens).toBe(600);
  });

  it("prefers inputTokenDetails over the deprecated field when both are present", () => {
    const out = flattenUsage({
      inputTokens: 1000,
      outputTokens: 10,
      cachedInputTokens: 111,
      inputTokenDetails: { noCacheTokens: 300, cacheReadTokens: 700, cacheWriteTokens: 0 },
    } as LanguageModelUsage);
    expect(out.cachedInputTokens).toBe(700);
  });

  // A provider reporting more cached tokens than prompt tokens would otherwise
  // produce a >100% hit rate and a negative uncached-token count.
  it("clamps cache counts into inputTokens", () => {
    const out = flattenUsage({
      inputTokens: 100,
      outputTokens: 0,
      inputTokenDetails: { noCacheTokens: 0, cacheReadTokens: 999, cacheWriteTokens: 999 },
    } as LanguageModelUsage);
    expect(out.cachedInputTokens).toBe(100);
    expect(out.cacheWriteTokens).toBe(0);
  });
});

describe("accumulateUsage", () => {
  it("adds across both inputs", () => {
    expect(
      accumulateUsage(
        {
          inputTokens: 1,
          cachedInputTokens: 1,
          cacheWriteTokens: 0,
          outputTokens: 2,
          totalTokens: 3,
        },
        {
          inputTokens: 10,
          cachedInputTokens: 5,
          cacheWriteTokens: 2,
          outputTokens: 20,
          totalTokens: 30,
        },
      ),
    ).toEqual({
      inputTokens: 11,
      cachedInputTokens: 6,
      cacheWriteTokens: 2,
      outputTokens: 22,
      totalTokens: 33,
    });
  });
});

describe("cacheHitRate", () => {
  it("is the cached share of input tokens", () => {
    expect(cacheHitRate({ inputTokens: 1000, cachedInputTokens: 750 })).toBe(0.75);
  });

  it("returns 0 rather than NaN when no input tokens were billed", () => {
    expect(cacheHitRate({ inputTokens: 0, cachedInputTokens: 0 })).toBe(0);
  });
});

describe("TokenUsageSchema", () => {
  it("rejects negative token counts", () => {
    expect(() =>
      TokenUsageSchema.parse({
        inputTokens: -1,
        outputTokens: 0,
        totalTokens: 0,
        modelId: "x",
        loopCount: 0,
        stepCount: 0,
      }),
    ).toThrow();
  });

  it("defaults the cache fields when absent", () => {
    const parsed = TokenUsageSchema.parse({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      modelId: "x",
      loopCount: 1,
      stepCount: 1,
    });
    expect(parsed.cachedInputTokens).toBe(0);
    expect(parsed.cacheWriteTokens).toBe(0);
  });
});

describe("readTurnUsage", () => {
  it("returns zeros when absent (first POST of a turn)", () => {
    expect(readTurnUsage(undefined)).toEqual(ZERO_TURN_USAGE);
  });

  it("reads a well-formed echoed value", () => {
    expect(
      readTurnUsage({
        inputTokens: 10,
        cachedInputTokens: 4,
        cacheWriteTokens: 1,
        outputTokens: 5,
        totalTokens: 15,
        postCount: 2,
      }),
    ).toEqual({
      inputTokens: 10,
      cachedInputTokens: 4,
      cacheWriteTokens: 1,
      outputTokens: 5,
      totalTokens: 15,
      postCount: 2,
    });
  });

  // A turn already in flight when the cache-accounting deploy lands echoes the
  // older four-field shape. Rejecting it would zero a running turn's counter.
  it("accepts the pre-cache-accounting shape and defaults the new fields", () => {
    expect(
      readTurnUsage({ inputTokens: 10, outputTokens: 5, totalTokens: 15, postCount: 2 }),
    ).toEqual({
      inputTokens: 10,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 5,
      totalTokens: 15,
      postCount: 2,
    });
  });

  // extra_state round-trips through the browser — every one of these is
  // reachable from the wire, and a throw here would kill the whole turn.
  it.each([
    ["null", null],
    ["a string", "12"],
    ["an array", [1, 2, 3]],
    ["a negative count", { inputTokens: -1, outputTokens: 0, totalTokens: 0, postCount: 1 }],
    ["a negative cached count", { inputTokens: 1, cachedInputTokens: -1, outputTokens: 0, totalTokens: 1, postCount: 1 }],
    ["a fractional count", { inputTokens: 1.5, outputTokens: 0, totalTokens: 0, postCount: 1 }],
    ["NaN", { inputTokens: NaN, outputTokens: 0, totalTokens: 0, postCount: 1 }],
    ["Infinity", { inputTokens: Infinity, outputTokens: 0, totalTokens: 0, postCount: 1 }],
    ["a missing field", { inputTokens: 1, outputTokens: 2 }],
    ["string-typed numbers", { inputTokens: "1", outputTokens: "2", totalTokens: "3", postCount: "1" }],
  ])("falls back to zeros for %s", (_label, input) => {
    expect(readTurnUsage(input)).toEqual(ZERO_TURN_USAGE);
  });

  it("never returns the same object twice (callers mutate their copy)", () => {
    expect(readTurnUsage(undefined)).not.toBe(readTurnUsage(undefined));
  });
});

describe("usageHiddenEvent / usageVisibleEvent", () => {
  const usage = {
    inputTokens: 100,
    cachedInputTokens: 75,
    cacheWriteTokens: 0,
    outputTokens: 50,
    totalTokens: 150,
    modelId: "gpt-4o",
    loopCount: 1,
    stepCount: 2,
  };

  it("usageHiddenEvent flags hidden:true with details list", () => {
    const e = usageHiddenEvent(usage);
    expect(e.event).toBe("copilotStatusUpdate");
    const data = e.data as Record<string, unknown>;
    expect(data.hidden).toBe(true);
    const details = data.details as Array<{ label: string; value: unknown }>;
    expect(details.find((d) => d.label === "Model")?.value).toBe("gpt-4o");
    expect(details.find((d) => d.label === "Total tokens")?.value).toBe(150);
  });

  it("usageHiddenEvent reports cached tokens and the hit rate", () => {
    const details = (usageHiddenEvent(usage).data as Record<string, unknown>)
      .details as Array<{ label: string; value: unknown }>;
    expect(details.find((d) => d.label === "Cached input tokens")?.value).toBe(75);
    expect(details.find((d) => d.label === "Cache hit rate")?.value).toBe("75.0%");
  });

  it("usageVisibleEvent renders a thousands-separated total", () => {
    const e = usageVisibleEvent({ ...usage, totalTokens: 12345 });
    const data = e.data as Record<string, unknown>;
    expect(data.message).toContain("12,345");
  });
});
