/**
 * Tier 2 — agents.json + status route smoke.
 * No LLM, no DB, no MCP. Just shape + headers.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { expect } from "expect";
import { Hono } from "hono";
import { agentsRouter } from "../../../src/routes/agents.ts";
import { createStatusRouter } from "../../../src/routes/status.ts";
import { createLocalStore, type Store } from "../../../src/lib/store.ts";

function app(store: Store = createLocalStore()) {
  const a = new Hono();
  a.route("/", agentsRouter);
  a.route("/", createStatusRouter(store));
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
    // No avatar: the descriptor carries no image, so the FINOS Workspace keeps its own icon.
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
    expect(features["prompt-suggestions"]).toHaveProperty("label");
    expect(features["model"]).toHaveProperty("type", "select");
  });

  it("lists the skills that come with Ines", async () => {
    const body = (await (await app().request("/agents.json")).json()) as {
      default_agent: { skills: { slug: string; description: string }[] };
    };
    expect(body.default_agent.skills.map((s) => s.slug)).toEqual(["html-report", "html-table", "html-chart"]);
    expect(body.default_agent.skills.every((s) => s.description.length > 0)).toBe(true);
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

  // This route is public, so it is given the store rather than reading it from the request: the
  // middleware that puts the services on the context runs for /v1/* only, and a route that asked the
  // context would answer that nothing is shared however the deployment is configured.
  it("says whether what the agent keeps is shared between replicas", async () => {
    const alone = (await (await app().request("/status")).json()) as { sharedState: boolean };
    expect(alone.sharedState).toBe(false);

    const sharing = { ...createLocalStore(), shared: true } as Store;
    const together = (await (await app(sharing).request("/status")).json()) as { sharedState: boolean };
    expect(together.sharedState).toBe(true);
  });
});
