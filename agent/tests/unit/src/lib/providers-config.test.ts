import { describe, it } from "node:test";
import { expect } from "expect";

// No model id is written in providers.ts, so these tests use made-up ids: the
// code must not care what a model is called. providers.ts reads its environment
// while the module is evaluated, so each case loads a fresh copy (the query
// string defeats the module cache).
const KEYS = ["OPENAI_API_KEY", "NVIDIA_API_KEY"] as const;

async function withProviders<T>(
  env: Partial<Record<(typeof KEYS)[number], string>>,
  fn: (mod: typeof import("../../../../src/lib/providers.ts")) => T,
): Promise<T> {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    return fn(await import(`../../../../src/lib/providers.ts?config=${crypto.randomUUID()}`));
  } finally {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

describe("resolveModel", () => {
  it("strips only the provider prefix, keeping any vendor segment of the model id", async () => {
    const id = await withProviders({ NVIDIA_API_KEY: "test-key" }, (m) => (m.resolveModel("nvidia:vendor/model-one") as { modelId: string }).modelId);
    expect(id).toBe("vendor/model-one");
  });

  it("talks Chat Completions to NVIDIA, which implements it, not the Responses API", async () => {
    const provider = await withProviders({ NVIDIA_API_KEY: "test-key" }, (m) => (m.resolveModel("nvidia:vendor/model-one") as { provider: string }).provider);
    expect(provider).toBe("openai.chat");
  });

  it("refuses an id with no known provider rather than guessing OpenAI", async () => {
    await withProviders({ OPENAI_API_KEY: "test-key" }, (m) => {
      expect(() => m.resolveModel("model-without-a-prefix")).toThrow(/No provider for model/);
      expect(() => m.resolveModel("nvidia:vendor/model-one")).toThrow(/No provider for model/);
    });
  });
});
