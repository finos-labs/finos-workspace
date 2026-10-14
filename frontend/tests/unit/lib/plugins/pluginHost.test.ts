// Tests isPluginHostUrl: which URLs count as served by the configured plugin host.
import { describe, expect, it } from "vitest";
import { isPluginHostUrl } from "~/lib/plugins";

describe("isPluginHostUrl", () => {
  const host = "http://localhost:5173";

  it("accepts plugin pages on the configured host", () => {
    expect(
      isPluginHostUrl(
        "http://localhost:5173/plugins/advanced-grouping?theme=dark",
        host,
      ),
    ).toBe(true);
  });

  it("rejects other origins", () => {
    expect(
      isPluginHostUrl("http://localhost:5174/plugins/advanced-grouping", host),
    ).toBe(false);
    expect(
      isPluginHostUrl("https://localhost:5173/plugins/advanced-grouping", host),
    ).toBe(false);
    expect(
      isPluginHostUrl("https://evil.example/plugins/advanced-grouping", host),
    ).toBe(false);
  });

  it("rejects everything when no valid host is configured", () => {
    const url = "http://localhost:5173/plugins/advanced-grouping";
    expect(isPluginHostUrl(url, "")).toBe(false);
    expect(isPluginHostUrl(url, undefined)).toBe(false);
    expect(isPluginHostUrl(url, "not a url")).toBe(false);
  });

  it("rejects empty or malformed URLs", () => {
    expect(isPluginHostUrl("", host)).toBe(false);
    expect(isPluginHostUrl("not a url", host)).toBe(false);
  });

  it("keeps to the base path of the host", () => {
    const based = "https://cdn.example.com/bq";
    expect(isPluginHostUrl("https://cdn.example.com/bq/plugins/pivot", based)).toBe(
      true,
    );
    expect(isPluginHostUrl("https://cdn.example.com/bq", based)).toBe(true);
    expect(isPluginHostUrl("https://cdn.example.com/other/app", based)).toBe(false);
    expect(isPluginHostUrl("https://cdn.example.com/bqx/app", based)).toBe(false);
  });
});
