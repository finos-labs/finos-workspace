import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginArtifactT } from "~/lib/state/copilot";
import { PluginArtifactFrame } from "~/plugins/PluginArtifactFrame";
import { getPluginArtifactCatalog, usePluginRegistryStore } from "~/plugins/registry";
import { PluginListingSchema } from "~/plugins/types";

interface FrameProps {
  traits: Record<string, unknown>;
  bindings: { trait: string; writable: boolean }[];
  permissions: string[];
  onWrite: (binding: unknown, value: unknown) => unknown;
  onCommand: (name: string, msg: unknown, buffers: ArrayBuffer[]) => Promise<unknown>;
}

const frame = vi.hoisted(() => ({ props: null as null | FrameProps }));

vi.mock("~/plugins/PluginFrame", () => ({
  default: (props: FrameProps) => {
    frame.props = props;
    return <div data-testid="frame" />;
  },
}));

const backend = vi.hoisted(() => ({ call: vi.fn() }));

vi.mock("~/api/plugins.api", () => ({
  callPluginBackend: backend.call,
  postPluginReports: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/state/theme", () => ({
  useShallowThemeStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ theme: "dark" }),
}));

const listing = PluginListingSchema.parse({
  enabled: true,
  etag: "1",
  plugins: [
    {
      id: "chart-kit",
      version: "1.0.0",
      name: "Chart kit",
      digest: `sha256-${"A".repeat(43)}`,
      entry: { module: "entry.js", styles: [] },
      files: { "entry.js": { size: 10, sha256: "a".repeat(64) } },
      csp: {},
      widgets: [
        {
          id: "bars",
          name: "Bars",
          permissions: [
            "core:default",
            "core:data:read",
            "core:params:write",
            "core:proxy:call",
            "core:ui:notify",
          ],
          model: { traits: { rows: { bind: "data" }, theme: { bind: "theme" } } },
          settings: {
            schema: { properties: { color: { type: "string" } } },
            defaults: { color: "blue" },
          },
          grid: { w: 20, h: 12 },
          artifact: {
            description: "Bars of x labels and y values",
            data: { type: "object", additionalProperties: false },
          },
        },
        { id: "clock", name: "Clock", permissions: [], standalone: true },
        {
          id: "query",
          name: "Query",
          permissions: [
            "core:default",
            "core:data:read",
            "core:backend:call",
            "core:state:write",
          ],
          routes: ["run"],
          model: {
            traits: {
              seed: { bind: "data" },
              state: { bind: "state", access: "readwrite" },
            },
          },
          artifact: {
            description: "A query",
            data: { type: "object", additionalProperties: false },
          },
        },
      ],
    },
  ],
});

const artifact: PluginArtifactT = {
  uuid: "a1",
  type: "plugin",
  name: "Sales bars",
  description: "Sales by month",
  plugin: { id: "chart-kit", widget: "bars" },
  data: { rows: [{ x: "jan", y: 3 }] },
  config: { color: "red" },
};

describe("a plugin component in the chat", () => {
  beforeEach(() => {
    frame.props = null;
    usePluginRegistryStore.getState().clear();
  });

  it("says it is loading until the plugins are known", () => {
    render(<PluginArtifactFrame artifact={artifact} />);
    expect(screen.getByText("Loading widget plugins")).toBeInTheDocument();
  });

  it("says it is not available when the user's roles do not grant the widget", () => {
    usePluginRegistryStore.getState().setListing({ ...listing, plugins: [] });
    render(<PluginArtifactFrame artifact={artifact} />);
    expect(screen.getByText(/not available to you/)).toBeInTheDocument();
  });

  it("gives the component the data the agent chose and the artifact's settings, read-only", () => {
    usePluginRegistryStore.getState().setListing(listing);
    render(<PluginArtifactFrame artifact={artifact} />);

    expect(screen.getByTestId("frame")).toBeInTheDocument();
    expect(frame.props?.traits.rows).toEqual({ rows: [{ x: "jan", y: 3 }] });
    expect(frame.props?.traits.theme).toMatchObject({ mode: "dark" });
    expect(frame.props?.bindings.every((b) => !b.writable)).toBe(true);
    expect(frame.props?.permissions).toEqual([
      "core:data:read",
      "core:default",
      "core:ui:notify",
    ]);
    expect(() => frame.props?.onWrite({ trait: "rows" }, 1)).toThrow();
  });

  it("refuses commands that need a dashboard", async () => {
    usePluginRegistryStore.getState().setListing(listing);
    render(<PluginArtifactFrame artifact={artifact} />);

    await expect(
      frame.props?.onCommand("core:proxy:call", { id: "x" }, []),
    ).rejects.toMatchObject({ code: "not_granted" });
    await expect(
      frame.props?.onCommand("core:backend:call", { route: "x" }, []),
    ).rejects.toMatchObject({ code: "not_granted" });
  });

  it("lets a component that declares routes call its backend as the user, and keep a state of its own", async () => {
    usePluginRegistryStore.getState().setListing(listing);
    backend.call.mockResolvedValue({ body: { rows: [[1]] } });
    const query: PluginArtifactT = {
      ...artifact,
      uuid: "q1",
      plugin: { id: "chart-kit", widget: "query" },
      data: { source: "files", sql: "SELECT 1" },
    };
    render(<PluginArtifactFrame artifact={query} />);

    expect(frame.props?.permissions).toEqual([
      "core:backend:call",
      "core:data:read",
      "core:default",
      "core:state:write",
    ]);
    expect(frame.props?.traits.seed).toEqual({ source: "files", sql: "SELECT 1" });
    await expect(
      frame.props?.onCommand(
        "core:backend:call",
        { route: "run", args: { sql: "SELECT 1" } },
        [],
      ),
    ).resolves.toEqual({ value: { rows: [[1]] } });
    expect(backend.call).toHaveBeenCalledWith("chart-kit", "run", {
      widget: "query",
      instance: "q1",
      args: { sql: "SELECT 1" },
    });
    await expect(
      frame.props?.onCommand("core:backend:call", { route: "other", args: {} }, []),
    ).rejects.toMatchObject({ code: "out_of_scope" });

    const stateBinding = frame.props?.bindings.find((b) => b.trait === "state");
    expect(stateBinding?.writable).toBe(true);
    expect(frame.props?.bindings.find((b) => b.trait === "seed")?.writable).toBe(false);
  });

  it("lists the widgets that can be an artifact for the agent, with what it must send", () => {
    expect(getPluginArtifactCatalog()).toEqual([]);
    usePluginRegistryStore.getState().setListing(listing);
    expect(
      getPluginArtifactCatalog().map((entry) => `${entry.plugin}/${entry.widget}`),
    ).toEqual(["chart-kit/bars", "chart-kit/query"]);
    expect(getPluginArtifactCatalog().slice(0, 1)).toEqual([
      {
        plugin: "chart-kit",
        widget: "bars",
        name: "Bars",
        description: "Bars of x labels and y values",
        data_schema: { type: "object", additionalProperties: false },
        config_schema: { properties: { color: { type: "string" } } },
      },
    ]);
  });
});
