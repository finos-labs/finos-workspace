import { beforeEach, describe, expect, it } from "vitest";
import { mockConfig } from "../../mocks/runtimeConfig";

// getDefaultCopilot uses a module-level cache, so we need a fresh import per test.
// We use dynamic import + vi.resetModules to bust the cache.

describe("getDefaultCopilot", () => {
  let getDefaultCopilot: typeof import("~/lib/constants").getDefaultCopilot;

  beforeEach(async () => {
    vi.resetModules();
    // Re-apply the runtime config mock after module reset
    vi.doMock("~/lib/runtimeConfig", () => ({
      getConfig: () => mockConfig,
      _resetConfig: vi.fn(),
    }));
    const mod = await import("~/lib/constants");
    getDefaultCopilot = mod.getDefaultCopilot;
  });

  it("returns a copilot with the correct id and name", () => {
    const copilot = getDefaultCopilot();
    expect(copilot.id).toBe("default-copilot");
    expect(copilot.name).toBe("Copilot");
  });

  it("builds the query endpoint from runtime AI URL", () => {
    const copilot = getDefaultCopilot();
    expect(copilot.endpoints.query).toBe(`${mockConfig.urls.ai}/v1/query`);
  });

  it("caches the copilot on subsequent calls", () => {
    const first = getDefaultCopilot();
    const second = getDefaultCopilot();
    expect(first).toBe(second);
  });

  it("includes expected feature flags", () => {
    const copilot = getDefaultCopilot();
    expect(copilot.features?.streaming).toBe(true);
    expect(copilot.features?.["file-upload"]).toBe(true);
    expect(copilot.features?.["widget-dashboard-select"]).toBe(true);
    expect(copilot.features?.["widget-global-search"]).toBe(true);
    expect(copilot.features?.["mcp-tools"]).toBe(true);
    expect(copilot.features?.["agent-orchestration"]).toBe(true);
  });

  it("includes workspace-web-search", () => {
    const copilot = getDefaultCopilot();
    expect(copilot.features?.["workspace-web-search"]).toBeDefined();
    expect(copilot.features?.["workspace-web-search"]).toEqual(
      expect.objectContaining({ label: "Web Search" }),
    );
  });
});

describe("getApiUrl / getAiApiUrl", () => {
  let constants: typeof import("~/lib/constants");

  beforeEach(async () => {
    mockConfig.urls.backend = "https://backend.test";
    mockConfig.urls.ai = "https://ai.test";
    vi.resetModules();
    vi.doMock("~/lib/runtimeConfig", () => ({
      getConfig: () => mockConfig,
      _resetConfig: vi.fn(),
    }));
    constants = await import("~/lib/constants");
  });

  it("getApiUrl returns urls.backend from runtime config", () => {
    expect(constants.getApiUrl()).toBe("https://backend.test");
  });

  it("getAiApiUrl returns urls.ai from runtime config", () => {
    expect(constants.getAiApiUrl()).toBe("https://ai.test");
  });
});
