import { describe, it } from "node:test";
import { expect } from "expect";
import { createApp } from "../../../src/app.ts";
import { createLimits } from "../../../src/auth/limits.ts";
import type { WorkspaceClient } from "../../../src/auth/workspace-client.ts";
import { loadConfig } from "../../../src/lib/config.ts";
import { createLocalStore } from "../../../src/lib/store.ts";
import { collectReference, renderOpenApi, renderReference } from "../../../scripts/reference/index.ts";

const ENV = {
  WORKSPACE_API_URL: "http://api:8000",
  WORKSPACE_ORIGIN: "http://localhost:3000",
  AGENT_METERING_TOKEN: "metering-token",
  AGENT_SCOPE_SECRET: "0123456789abcdef0123",
  AGENT_CORS_ORIGINS: "http://localhost:3000",
};

const rejecting: WorkspaceClient = {
  async getUser() {
    return { ok: false, reason: "rejected" };
  },
  async recordQuery() {
    return { ok: true, value: undefined };
  },
  async recordTokens() {},
  async authorize() {
    return { ok: true, value: { allowed: true, deniedModel: null, deniedTools: [], disabledCapabilities: [] } };
  },
  async ready() {
    return true;
  },
};

describe("the reference data", () => {
  it("renders as JSON with its five parts", async () => {
    const reference = JSON.parse(await renderReference());
    expect(Object.keys(reference).sort()).toEqual(["agentsFile", "http", "mcp", "metrics", "protocol"]);
  });

  it("records the features of agents.json that an environment variable switches on", async () => {
    const { agentsFile } = await collectReference();
    expect(agentsFile.conditional).toEqual([
      { feature: "model", variable: "DEFAULT_MODEL" },
      { feature: "model", variable: "AGENT_MODELS" },
      { feature: "speech-to-text", variable: "AGENT_TRANSCRIBE_MODEL" },
    ]);
    expect(Object.keys(agentsFile.file)).toEqual(["default_agent"]);
  });

  it("asks for a token on exactly the routes that it says need one", async () => {
    const config = loadConfig(ENV);
    const store = createLocalStore();
    const app = createApp({ config, workspace: rejecting, store, limits: createLimits({ store, maxConcurrent: 4 }) });
    const { http } = await collectReference();
    const answers = await Promise.all(
      http.routes.map(async (route) => ({
        route: `${route.method} ${route.path}`,
        refused: (await app.request(route.path, { method: route.method })).status === 401,
        needsToken: route.needsToken,
      })),
    );
    expect(answers.filter((answer) => answer.refused !== answer.needsToken)).toEqual([]);
  });

  it("describes every route that the app serves in the OpenAPI document", async () => {
    const config = loadConfig(ENV);
    const store = createLocalStore();
    const app = createApp({ config, workspace: rejecting, store, limits: createLimits({ store, maxConcurrent: 4 }) });
    const document = JSON.parse(renderOpenApi()) as {
      openapi: string;
      paths: Record<string, Record<string, { summary: string; description: string; responses: Record<string, unknown>; requestBody?: unknown; security?: unknown }>>;
    };
    expect(document.openapi).toBe("3.1.0");

    const served = app.routes.filter((route) => route.method !== "ALL").map((route) => `${route.method} ${route.path}`);
    const described = Object.entries(document.paths).flatMap(([path, item]) =>
      Object.keys(item).map((method) => `${method.toUpperCase()} ${path}`),
    );
    expect(described.sort()).toEqual(served.sort());

    for (const item of Object.values(document.paths)) {
      for (const operation of Object.values(item)) {
        expect(operation.summary.trim()).not.toBe("");
        expect(operation.description.trim()).not.toBe("");
        expect(Object.keys(operation.responses).length).toBeGreaterThan(0);
      }
    }
  });

  it("gives every route that needs a token the security scheme of the document", async () => {
    const document = JSON.parse(renderOpenApi()) as {
      paths: Record<string, Record<string, { security?: unknown }>>;
    };
    const secured = Object.entries(document.paths).flatMap(([path, item]) =>
      Object.entries(item)
        .filter(([, operation]) => operation.security !== undefined)
        .map(([method]) => `${method.toUpperCase()} ${path}`),
    );
    expect(secured.sort()).toEqual([
      "POST /v1/enhance_prompt",
      "POST /v1/generate/chat/title",
      "POST /v1/generate/code",
      "POST /v1/generate/dashboard/title",
      "POST /v1/generate/widget_info",
      "POST /v1/generate/widget_info/file",
      "POST /v1/query",
      "POST /v1/transcribe",
    ]);
  });

  it("describes each metric and the values of its labels", async () => {
    const { metrics } = await collectReference();
    const names = metrics.map((metric) => metric.name);
    expect(new Set(names).size).toBe(names.length);
    for (const metric of metrics) {
      expect(metric.help.trim()).not.toBe("");
      expect(metric.name).toMatch(/^[a-z][a-z0-9_]*$/);
      for (const label of Object.keys(metric.labelValues ?? {})) expect(metric.labels).toContain(label);
    }
  });

  it("describes each field of each helper request", async () => {
    const { http } = await collectReference();
    const missing = http.helpers.flatMap((helper) =>
      helper.fields.filter((field) => field.description.trim() === "").map((field) => `${helper.path} ${field.path}`),
    );
    expect(missing).toEqual([]);
  });

  it("describes each field of the query request and of a widget", async () => {
    const { protocol } = await collectReference();
    const missing = [...protocol.queryRequest, ...protocol.widget].filter((field) => field.description.trim() === "");
    expect(missing.map((field) => field.path)).toEqual([]);
  });

  it("describes each argument of each bridge command", async () => {
    const { protocol } = await collectReference();
    const missing = protocol.bridgeCommands.flatMap((command) =>
      command.fields.filter((field) => field.description.trim() === "").map((field) => `${command.name}.${field.path}`),
    );
    expect(missing).toEqual([]);
  });

  it("describes each argument of each tool of the MCP server", async () => {
    const { mcp } = await collectReference();
    const missing = mcp.tools.flatMap((tool) =>
      tool.fields.filter((field) => field.description.trim() === "").map((field) => `${tool.name}.${field.path}`),
    );
    expect(missing).toEqual([]);
  });
});
