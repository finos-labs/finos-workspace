import { describe, expect, it } from "vitest";
import type { ParamDef } from "~/components/types";
import {
  assetPath,
  checkStateWrite,
  coerceParamValue,
  commandPermission,
  exportFile,
  RateLimiter,
  readExportOptions,
  safeFilename,
  safeLink,
  serverCallError,
  serverCallRequest,
  traitBindings,
  ViolationCounter,
} from "~/plugins/authority";
import { CommandError } from "~/plugins/protocol";

const perms = (...p: string[]) => new Set(["core:default", ...p]);

describe("the runtime authority", () => {
  describe("trait bindings", () => {
    it("binds the default traits, data only with core:data:read", () => {
      const without = traitBindings({ model: null }, perms());
      expect(without.map((b) => b.trait)).not.toContain("data");
      const withData = traitBindings({ model: null }, perms("core:data:read"));
      expect(withData.map((b) => b.trait)).toContain("data");
    });

    it("makes params and state writable only with their permissions", () => {
      const readOnly = traitBindings({ model: null }, perms("core:data:read"));
      expect(readOnly.filter((b) => b.writable)).toEqual([]);
      const writable = traitBindings(
        { model: null },
        perms("core:params:write", "core:state:write"),
      );
      expect(
        writable
          .filter((b) => b.writable)
          .map((b) => b.trait)
          .sort(),
      ).toEqual(["params", "state"]);
    });

    it("maps declared traits and refuses writes the permission does not allow", () => {
      const bindings = traitBindings(
        {
          model: {
            traits: {
              rows: { bind: "data", access: "read" },
              filter: { bind: "param:filter", access: "readwrite" },
              size: { bind: "config:size", access: "read" },
              bogus: { bind: "window", access: "read" },
            },
          },
        },
        perms("core:data:read"),
      );
      expect(bindings.map((b) => [b.trait, b.source, b.key, b.writable])).toEqual([
        ["rows", "data", undefined, false],
        ["filter", "param", "filter", false],
        ["size", "config", "size", false],
      ]);
    });
  });

  it("gives the frame nothing of the widget's MCP link (WIDGETS-JSON 5.3, rule 7)", () => {
    // No trait binds it, and no host command calls an MCP tool
    expect(
      traitBindings(
        {
          model: {
            traits: {
              link: { bind: "mcp_tool", access: "read" },
              tool: { bind: "meta:mcp_tool", access: "read" },
            },
          },
        },
        perms("core:data:read"),
      ),
    ).toEqual([]);
    expect(() => commandPermission("core:mcp:call", perms("core:data:read"))).toThrow(
      expect.objectContaining({ name: "unknown_command" }),
    );
  });

  describe("param writes", () => {
    const number = { paramName: "n", type: "number" } as ParamDef;
    const text = { paramName: "t", type: "text" } as ParamDef;
    const multi = { paramName: "m", type: "text", multiSelect: true } as ParamDef;

    it("coerces values to the param's type", () => {
      expect(coerceParamValue(number, "5")).toBe(5);
      expect(coerceParamValue(text, 7)).toBe("7");
      expect(coerceParamValue(multi, ["a", "b"])).toEqual(["a", "b"]);
    });

    it("refuses values of the wrong shape", () => {
      expect(() => coerceParamValue(number, "abc")).toThrow(CommandError);
      expect(() => coerceParamValue(text, { a: 1 })).toThrow(CommandError);
      expect(() => coerceParamValue(multi, "a")).toThrow(CommandError);
      expect(() => coerceParamValue(text, "x".repeat(5000))).toThrow(CommandError);
    });

    it("caps state at 64 KiB", () => {
      expect(checkStateWrite({ a: 1 })).toEqual({ a: 1 });
      expect(() => checkStateWrite({ a: "x".repeat(70 * 1024) })).toThrow(CommandError);
    });
  });

  describe("commands", () => {
    it("needs the command's permission", () => {
      expect(() => commandPermission("core:ui:notify", perms())).toThrow(
        /not_granted|needs/,
      );
      expect(() =>
        commandPermission("core:ui:notify", perms("core:ui:notify")),
      ).not.toThrow();
      expect(() => commandPermission("core:shell:exec", perms())).toThrow(CommandError);
    });

    it("lets every widget read its plugin's own assets, and nothing else", () => {
      expect(() => commandPermission("core:asset:read", perms())).not.toThrow();
      expect(assetPath({ path: "assets/duckdb-eh.wasm" })).toBe(
        "assets/duckdb-eh.wasm",
      );
      expect(assetPath({ path: "assets/fonts/Inter.woff2" })).toBe(
        "assets/fonts/Inter.woff2",
      );
      for (const path of [
        "entry.js",
        "plugin.json",
        "backend/server.py",
        "assets/../plugin.json",
        "assets/./x",
        "/assets/x",
        "assets/",
        "assets/a b",
        42,
        undefined,
      ])
        expect(() => assetPath({ path })).toThrow(
          expect.objectContaining({ name: "invalid_args" }),
        );
    });

    it("opens only https and mailto links", () => {
      expect(safeLink("https://example.com/a")).toBe("https://example.com/a");
      expect(safeLink("mailto:someone@example.com")).toContain("mailto:");
      for (const bad of [
        "javascript:alert(1)",
        "data:text/html,x",
        "http://example.com",
        5,
      ])
        expect(() => safeLink(bad)).toThrow(CommandError);
    });

    it("cleans file names", () => {
      expect(safeFilename("../../etc/passwd")).toBe("_.._etc_passwd");
      expect(safeFilename("")).toBe("download");
      expect(safeFilename("report.csv")).toBe("report.csv");
    });

    it("calls only the proxies and routes the widget declares, with an object of arguments", () => {
      expect(() => commandPermission("core:proxy:call", perms())).toThrow(/needs/);
      expect(() => commandPermission("core:backend:call", perms())).toThrow(/needs/);
      expect(
        serverCallRequest({ id: "quote", args: { symbol: "IBM" } }, "id", ["quote"]),
      ).toEqual({ name: "quote", args: { symbol: "IBM" } });
      expect(serverCallRequest({ id: "quote" }, "id", ["quote"]).args).toEqual({});
      expect(
        serverCallRequest({ route: "forecast", args: { region: "emea" } }, "route", [
          "forecast",
        ]),
      ).toEqual({ name: "forecast", args: { region: "emea" } });
      for (const [msg, key] of [
        [{ id: "other" }, "id"],
        // A proxy's id does not name a route, nor the other way round
        [{ id: "forecast" }, "route"],
        // The frame names a proxy; it never gives a URL
        [{ url: "https://169.254.169.254/" }, "id"],
      ] as const)
        expect(() => serverCallRequest(msg, key, ["quote", "forecast"])).toThrow(
          expect.objectContaining({ name: "out_of_scope" }),
        );
      expect(() =>
        serverCallRequest({ id: "quote", args: ["IBM"] }, "id", ["quote"]),
      ).toThrow(expect.objectContaining({ name: "invalid_args" }));
    });

    it("turns the API's refusals into the frame's error names", () => {
      const refusal = (code: string, message = "why") => ({
        response: { data: { detail: { code, message } } },
      });
      expect(serverCallError(refusal("invalid_args"))).toMatchObject({
        name: "invalid_args",
        message: "why",
      });
      expect(serverCallError(refusal("permission_denied")).name).toBe("not_granted");
      expect(serverCallError(refusal("unknown_route")).name).toBe("out_of_scope");
      expect(serverCallError(refusal("busy")).name).toBe("rate_limited");
      expect(serverCallError(refusal("response_too_large")).name).toBe("too_large");
      for (const code of [
        "secret_missing",
        "egress_refused",
        "backend_mismatch",
        "backend_unavailable",
      ])
        expect(serverCallError(refusal(code)).name).toBe("unavailable");
      expect(serverCallError(new Error("Network Error"))).toMatchObject({
        name: "unavailable",
        message: "the call failed",
      });
    });
  });

  describe("budgets", () => {
    it("limits the rate with a burst", () => {
      let now = 0;
      const limiter = new RateLimiter(10, 3, () => now);
      expect([limiter.take(), limiter.take(), limiter.take(), limiter.take()]).toEqual([
        true,
        true,
        true,
        false,
      ]);
      now = 200;
      expect(limiter.take()).toBe(true);
    });

    it("ends a frame after three violations in ten seconds", () => {
      let now = 0;
      const counter = new ViolationCounter(3, 10_000, () => now);
      expect(counter.add()).toBe(false);
      now = 5000;
      expect(counter.add()).toBe(false);
      now = 16_000; // the first two are older than ten seconds now
      expect(counter.add()).toBe(false);
      now = 17_000;
      expect(counter.add()).toBe(false);
      now = 18_000;
      expect(counter.add()).toBe(true);
    });
  });

  describe("exports, as the plugin's code decides them", () => {
    const geojson = {
      id: "geojson",
      label: "Visible features (GeoJSON)",
      extension: "geojson",
      mime: "application/geo+json",
    };

    it("takes whatever options the plugin offers, and none", () => {
      expect(readExportOptions([geojson])).toEqual([geojson]);
      expect(readExportOptions([])).toEqual([]);
      expect(readExportOptions(undefined)).toEqual([]);
    });

    it("refuses options that do not say what they are", () => {
      for (const bad of [
        "csv",
        [{ id: "rows" }],
        [{ ...geojson, extension: "geo.json" }],
        [{ ...geojson, mime: "text/html; charset=x" }],
        [{ ...geojson, extra: true }],
        [geojson, geojson],
        Array.from({ length: 17 }, (_, i) => ({ ...geojson, id: `o${i}` })),
      ])
        expect(() => readExportOptions(bad)).toThrow(CommandError);
    });

    it("saves what exportData delivers, typed as its option says", async () => {
      const text = exportFile('{"type":"FeatureCollection"}', geojson);
      expect(text?.type).toBe("application/geo+json");
      expect(await text?.text()).toBe('{"type":"FeatureCollection"}');
      const bytes = exportFile(new Uint8Array([1, 2, 3]), geojson);
      expect(bytes?.size).toBe(3);
      expect(exportFile(new Blob(["x"]), geojson)?.type).toBe("application/geo+json");
      expect(exportFile(null, geojson)).toBeNull();
      expect(() => exportFile({ rows: [] }, geojson)).toThrow(CommandError);
    });
  });
});
