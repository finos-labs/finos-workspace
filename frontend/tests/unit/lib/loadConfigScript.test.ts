import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfigScript } from "~/lib/loadConfigScript";
import { _resetConfig } from "~/lib/runtimeConfig";

describe("loadConfigScript", () => {
  const load = vi.fn<(url: string) => Promise<unknown>>();

  beforeEach(() => {
    load.mockReset().mockResolvedValue(undefined);
    vi.mocked(_resetConfig).mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("loads nothing in the page, which has its config script already", async () => {
    vi.stubEnv("MODE", "runtime");

    await loadConfigScript(load);

    expect(load).not.toHaveBeenCalled();
    expect(_resetConfig).not.toHaveBeenCalled();
  });

  it("loads nothing when the build has no config script", async () => {
    vi.stubGlobal("window", undefined);

    await loadConfigScript(load);

    expect(load).not.toHaveBeenCalled();
  });

  it("loads the page's config script in a worker and reads the config afresh", async () => {
    vi.stubEnv("MODE", "runtime");
    vi.stubGlobal("window", undefined);

    await loadConfigScript(load);

    expect(load).toHaveBeenCalledExactlyOnceWith("/config.js");
    expect((globalThis as { window?: unknown }).window).toBe(globalThis);
    expect(_resetConfig).toHaveBeenCalledTimes(1);
  });

  it("goes on with the environment's config when the script cannot be loaded", async () => {
    vi.stubEnv("MODE", "runtime");
    vi.stubGlobal("window", undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    load.mockRejectedValue(new Error("offline"));

    await expect(loadConfigScript(load)).resolves.toBeUndefined();

    expect(error).toHaveBeenCalled();
    expect(_resetConfig).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});
