import { describe, it, expect } from "bun:test";
import { loadConfig } from "../../../../src/lib/config";

const WORKSPACE_ENV = {
  WORKSPACE_API_URL: "http://api:8000/",
  WORKSPACE_ORIGIN: "http://localhost:3000/",
  INES_METERING_TOKEN: "metering-token",
  INES_SCOPE_SECRET: "0123456789abcdef0123",
  INES_CORS_ORIGINS: "http://localhost:3000",
};

describe("loadConfig — workspace auth (the default)", () => {
  it("reads a complete deployment", () => {
    const config = loadConfig({ ...WORKSPACE_ENV, DEFAULT_MODEL: "nvidia:some/model" });
    expect(config.auth).toEqual({
      mode: "workspace",
      apiUrl: "http://api:8000",
      origin: "http://localhost:3000",
      meteringToken: "metering-token",
      cacheSeconds: 30,
    });
    expect(config.corsOrigins).toEqual(["http://localhost:3000"]);
    expect(config.scopeSecret).toBe("0123456789abcdef0123");
    expect(config.models).toEqual(["nvidia:some/model"]);
    expect(config.maxBodyBytes).toBe(64 * 1024 * 1024);
    expect(config.maxConcurrentQueries).toBe(4);
    expect(config.metricsPort).toBe(9464);
  });

  it("does not run open: everything it is missing is named in one error", () => {
    let message = "";
    try {
      loadConfig({});
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("Invalid configuration");
    expect(message).toContain("WORKSPACE_API_URL is required");
    expect(message).toContain("WORKSPACE_ORIGIN is required");
    expect(message).toContain("INES_METERING_TOKEN is required");
    expect(message).toContain("INES_SCOPE_SECRET is required");
    expect(message).toContain("INES_CORS_ORIGINS is required");
  });

  it("refuses a short scope secret, a bad API URL and a CORS entry that is not an origin", () => {
    expect(() => loadConfig({ ...WORKSPACE_ENV, INES_SCOPE_SECRET: "short" })).toThrow("at least 16 characters");
    expect(() => loadConfig({ ...WORKSPACE_ENV, WORKSPACE_API_URL: "ftp://api" })).toThrow("must be an http(s) URL");
    expect(() => loadConfig({ ...WORKSPACE_ENV, WORKSPACE_ORIGIN: "localhost:3000" })).toThrow("WORKSPACE_ORIGIN must be an origin");
    expect(() => loadConfig({ ...WORKSPACE_ENV, WORKSPACE_ORIGIN: "http://a.test/path" })).toThrow("WORKSPACE_ORIGIN must be an origin");
    expect(() => loadConfig({ ...WORKSPACE_ENV, INES_CORS_ORIGINS: "localhost:3000" })).toThrow("not an origin");
    expect(() => loadConfig({ ...WORKSPACE_ENV, INES_CORS_ORIGINS: "http://a.test/path" })).toThrow("not an origin");
  });

  it("takes several origins, or * for every origin", () => {
    expect(loadConfig({ ...WORKSPACE_ENV, INES_CORS_ORIGINS: "http://a.test, https://b.test:8443" }).corsOrigins).toEqual([
      "http://a.test",
      "https://b.test:8443",
    ]);
    expect(loadConfig({ ...WORKSPACE_ENV, INES_CORS_ORIGINS: "*" }).corsOrigins).toBe("*");
  });
});

describe("loadConfig — INES_AUTH=none", () => {
  it("needs nothing else, and allows every origin", () => {
    const config = loadConfig({ INES_AUTH: "none" });
    expect(config.auth).toEqual({ mode: "none" });
    expect(config.corsOrigins).toBe("*");
    expect(config.scopeSecret).toBeNull();
  });

  it("refuses a mode it does not know", () => {
    expect(() => loadConfig({ INES_AUTH: "basic" })).toThrow("INES_AUTH must be workspace or none");
  });
});

describe("loadConfig — models and limits", () => {
  it("offers DEFAULT_MODEL first and then INES_MODELS, without repeats", () => {
    const config = loadConfig({
      INES_AUTH: "none",
      DEFAULT_MODEL: "nvidia:a",
      INES_MODELS: "nvidia:b, nvidia:a ,openai:c",
    });
    expect(config.models).toEqual(["nvidia:a", "nvidia:b", "openai:c"]);
  });

  it("offers no model when none is configured, and refuses one without a provider", () => {
    expect(loadConfig({ INES_AUTH: "none" }).models).toEqual([]);
    expect(() => loadConfig({ INES_AUTH: "none", INES_MODELS: "just-a-model" })).toThrow("<provider>:<model>");
  });

  it("reads the limits, turns the metrics port off with 0, and refuses nonsense", () => {
    const config = loadConfig({
      INES_AUTH: "none",
      INES_MAX_BODY_MB: "8",
      INES_MAX_CONCURRENT_QUERIES: "2",
      INES_METRICS_PORT: "0",
    });
    expect(config.maxBodyBytes).toBe(8 * 1024 * 1024);
    expect(config.maxConcurrentQueries).toBe(2);
    expect(config.metricsPort).toBeNull();
    expect(() => loadConfig({ INES_AUTH: "none", INES_MAX_CONCURRENT_QUERIES: "0" })).toThrow("at least 1");
    expect(() => loadConfig({ INES_AUTH: "none", INES_MAX_BODY_MB: "lots" })).toThrow("whole number");
  });
});

describe("loadConfig — the Workspace's files", () => {
  it("fetches the links on the browser's address from the API's, with workspace auth and its origin", () => {
    const config = loadConfig({ ...WORKSPACE_ENV, WORKSPACE_PUBLIC_URL: "http://localhost:8000/" });
    expect(config.workspaceFiles).toEqual({
      publicUrl: "http://localhost:8000",
      internalUrl: "http://api:8000",
      origin: "http://localhost:3000",
    });
  });

  it("is not set unless asked for", () => {
    expect(loadConfig(WORKSPACE_ENV).workspaceFiles).toBeNull();
    expect(loadConfig({ INES_AUTH: "none" }).workspaceFiles).toBeNull();
  });

  it("without users, takes the API's address from WORKSPACE_API_URL, or the same one", () => {
    const files = { INES_AUTH: "none", WORKSPACE_PUBLIC_URL: "http://localhost:8000", WORKSPACE_ORIGIN: "http://localhost:3000" };
    expect(loadConfig({ ...files, WORKSPACE_API_URL: "http://127.0.0.1:8000/" }).workspaceFiles).toEqual({
      publicUrl: "http://localhost:8000",
      internalUrl: "http://127.0.0.1:8000",
      origin: "http://localhost:3000",
    });
    expect(loadConfig(files).workspaceFiles).toEqual({
      publicUrl: "http://localhost:8000",
      internalUrl: "http://localhost:8000",
      origin: "http://localhost:3000",
    });
  });

  it("needs WORKSPACE_ORIGIN for them without users too: every call to the API carries it", () => {
    expect(() => loadConfig({ INES_AUTH: "none", WORKSPACE_PUBLIC_URL: "http://localhost:8000" })).toThrow(
      "WORKSPACE_ORIGIN is required with INES_AUTH=workspace or WORKSPACE_PUBLIC_URL",
    );
    expect(loadConfig({ INES_AUTH: "none" }).auth).toEqual({ mode: "none" });
  });

  it("refuses an address with a path", () => {
    expect(() => loadConfig({ ...WORKSPACE_ENV, WORKSPACE_PUBLIC_URL: "http://localhost:8000/api" })).toThrow("WORKSPACE_PUBLIC_URL");
  });
});
