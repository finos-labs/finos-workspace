/**
 * Tier 2 — agents.json + status route smoke.
 * No LLM, no DB, no MCP. Just shape + headers.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { agentsRouter } from "../../../src/routes/agents";
import { statusRouter } from "../../../src/routes/status";

function app() {
  const a = new Hono();
  a.route("/", agentsRouter);
  a.route("/", statusRouter);
  return a;
}

// The only model this agent offers is the one configured in DEFAULT_MODEL.
const savedDefaultModel = process.env.DEFAULT_MODEL;
beforeEach(() => {
  process.env.DEFAULT_MODEL = "test-provider:test-model";
});
afterEach(() => {
  if (savedDefaultModel === undefined) delete process.env.DEFAULT_MODEL;
  else process.env.DEFAULT_MODEL = savedDefaultModel;
});

describe("GET /agents.json", () => {
  it("offers the configured model, and no picker when none is configured", async () => {
    const withModel = (await (await app().request("/agents.json")).json()) as {
      default_agent: { features: { model?: { default: string; options: { value: string }[] } } };
    };
    expect(withModel.default_agent.features.model?.default).toBe("test-provider:test-model");
    expect(withModel.default_agent.features.model?.options.map((o) => o.value)).toEqual([
      "test-provider:test-model",
    ]);

    delete process.env.DEFAULT_MODEL;
    const without = (await (await app().request("/agents.json")).json()) as {
      default_agent: { features: Record<string, unknown> };
    };
    expect(without.default_agent.features).not.toHaveProperty("model");
  });

  it("returns the default_agent descriptor", async () => {
    const res = await app().request("/agents.json");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { default_agent: Record<string, unknown> };
    expect(body.default_agent.name).toBe("Ines");
    // No avatar: the descriptor carries no image, so the Workspace keeps its own icon.
    expect(body.default_agent).not.toHaveProperty("image");
    expect(body.default_agent).toHaveProperty("endpoints");
    expect(body.default_agent).toHaveProperty("features");
  });

  it("advertises the supported feature flags", async () => {
    const res = await app().request("/agents.json");
    const body = (await res.json()) as {
      default_agent: { features: Record<string, boolean> };
    };
    const features = body.default_agent.features;
    expect(features.streaming).toBe(true);
    expect(features["mcp-tools"]).toBe(true);
    expect(features["generative-ui"]).toBe(true);
    expect(features["prompt-suggestions"]).toHaveProperty("label");
    expect(features["model"]).toHaveProperty("type", "select");
  });
});

describe("GET /status", () => {
  it("returns 200 with status: ok and an ISO timestamp", async () => {
    const res = await app().request("/status");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; timestamp: string };
    expect(body.status).toBe("ok");
    expect(() => new Date(body.timestamp).toISOString()).not.toThrow();
  });
});
