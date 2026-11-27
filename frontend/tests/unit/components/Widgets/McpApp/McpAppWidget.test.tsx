// Copyright FINOS contributors. Licensed under the Apache License, Version 2.0.

import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WidgetT } from "~/components/types";
import McpAppWidget from "~/components/Widgets/McpApp/McpAppWidget";
import {
  HOST_REFUSAL_CODE,
  MCP_APP_MIME_TYPE,
  type McpAppConfig,
  OUTER_SANDBOX,
} from "~/components/Widgets/McpApp/mcpAppHost";
import { CONSENT_ARM_MS } from "~/components/Widgets/McpApp/useCallConsent";
import { useCopilotDataStore } from "~/lib/state/copilotData";
import { type McpServer, type McpTool, useMcpToolsStore } from "~/lib/state/mcpTools";
import { useThemeStore } from "~/lib/state/theme";
import { mockConfig } from "../../../../mocks/runtimeConfig";
import { renderWidget } from "../WidgetTestWrapper";

type Handler = (params: Record<string, unknown>) => Promise<unknown>;

// A stand-in for the SDK's AppBridge that keeps the handlers the widget sets, so
// a test can play the part of the view.
const bridges = vi.hoisted(() => [] as FakeBridge[]);
type FakeBridge = {
  setHostContext: ReturnType<typeof vi.fn>;
  oncalltool: Handler;
  onopenlink: Handler;
  onupdatemodelcontext: Handler;
  onlistresources: Handler;
  oninitialized: () => Promise<void>;
  sendToolInput: ReturnType<typeof vi.fn>;
  sendToolResult: ReturnType<typeof vi.fn>;
  sendToolCancelled: ReturnType<typeof vi.fn>;
};

vi.mock("@modelcontextprotocol/ext-apps/app-bridge", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@modelcontextprotocol/ext-apps/app-bridge")>();
  class AppBridge {
    connect = vi.fn(async () => {});
    close = vi.fn(async () => {});
    teardownResource = vi.fn(async () => ({}));
    setHostContext = vi.fn();
    sendSandboxResourceReady = vi.fn(async () => {});
    sendToolInput = vi.fn(async () => {});
    sendToolResult = vi.fn(async () => {});
    sendToolCancelled = vi.fn(async () => {});
    constructor() {
      bridges.push(this as unknown as FakeBridge);
    }
  }
  class PostMessageTransport {}
  return { ...actual, AppBridge, PostMessageTransport };
});

vi.mock("~/components/DraggableCard", () => ({
  default: ({
    title,
    extraNavbarElements,
    children,
  }: {
    title: string;
    extraNavbarElements?: ReactNode;
    children: ReactNode;
  }) => (
    <div>
      <h2>{title}</h2>
      {extraNavbarElements}
      {children}
    </div>
  ),
}));

const SERVER_URL = "https://mcp.example.com/mcp";
const RESOURCE_URI = "ui://orders/view";
const ROWS = [{ id: "O1", qty: 10 }];

const uiTool = (name: string, extra: Partial<McpTool> = {}): McpTool => ({
  id: name,
  name,
  description: "",
  enabled: true,
  _meta: { ui: { resourceUri: RESOURCE_URI } },
  ...extra,
});
const plainTool = (name: string, extra: Partial<McpTool> = {}): McpTool => ({
  id: name,
  name,
  description: "",
  enabled: true,
  ...extra,
});

const listOrders = uiTool("list_orders", {
  annotations: { readOnlyHint: true, title: "Open orders" },
});
const editOrders = uiTool("edit_orders");
const getOrder = plainTool("get_order", { annotations: { readOnlyHint: true } });
const bookOrder = plainTool("book_order", { annotations: { readOnlyHint: false } });
const modelOnly = plainTool("rank_orders", {
  _meta: { ui: { visibility: ["model"] } },
});
const disabledTool = plainTool("cancel_order", { enabled: false });

const callTool = vi.fn();
const readResource = vi.fn();
const retry = vi.fn();

function setServers(servers: Partial<McpServer>[]) {
  useMcpToolsStore.setState({
    servers: servers as McpServer[],
    mcpConnectionRegistry: Object.fromEntries(
      servers.map((server) => [
        server.id,
        {
          state: "ready",
          callTool,
          readResource,
          resources: [],
          retry,
          tools: [],
          error: undefined,
        },
      ]),
    ) as never,
  });
}

const ordersServer: Partial<McpServer> = {
  id: "orders",
  name: "Orders",
  url: SERVER_URL,
  enabled: true,
  tools: [editOrders, listOrders, getOrder, bookOrder, modelOnly, disabledTool],
};

const configured = (config: McpAppConfig, extra: Partial<WidgetT> = {}) => ({
  widgetOverrides: { name: "Open orders", storage: { mcpApp: config }, ...extra },
});

// jsdom has no ResizeObserver. This one records what is observed, so a test can
// resize the app's box.
const observers: FakeResizeObserver[] = [];
class FakeResizeObserver {
  observed: Element[] = [];
  constructor(readonly callback: ResizeObserverCallback) {
    observers.push(this);
  }
  observe(element: Element) {
    this.observed.push(element);
  }
  disconnect() {
    this.observed = [];
  }
  resize(width: number, height: number) {
    this.callback(
      [{ contentRect: { width, height } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
}

// The dialog lets a call be allowed only once it has been on screen for a moment.
const letConsentArm = () => {
  const later = Date.now() + CONSENT_ARM_MS;
  vi.spyOn(Date, "now").mockReturnValue(later);
};

async function renderApp(
  config: McpAppConfig = { serverUrl: SERVER_URL, toolName: "list_orders" },
  extra: Partial<WidgetT> = {},
) {
  const view = renderWidget(<McpAppWidget />, configured(config, extra));
  await waitFor(() => expect(bridges.length).toBeGreaterThan(0));
  return { ...view, bridge: bridges[bridges.length - 1] as FakeBridge };
}

beforeEach(() => {
  bridges.length = 0;
  vi.clearAllMocks();
  mockConfig.mcpApps.sandboxUrl = "http://*.sandbox.localhost:3001";
  observers.length = 0;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  readResource.mockResolvedValue({
    contents: [{ uri: RESOURCE_URI, mimeType: MCP_APP_MIME_TYPE, text: "<p>app</p>" }],
  });
  callTool.mockResolvedValue({ content: [], structuredContent: { rows: ROWS } });
  setServers([ordersServer]);
  useCopilotDataStore.setState({ dashboardWidgetsData: {} });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  mockConfig.mcpApps.sandboxUrl = "";
});

describe("setting up an MCP App widget", () => {
  it("offers only servers with a tool that has an app, and starts on a tool that only reads", async () => {
    setServers([
      ordersServer,
      {
        id: "docs",
        name: "Docs",
        url: "https://docs.example.com/mcp",
        enabled: true,
        tools: [getOrder],
      },
    ]);
    renderWidget(<McpAppWidget />);

    const [serverSelect, toolSelect] = screen.getAllByRole("combobox");
    expect(
      within(serverSelect as HTMLElement)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Orders"]);
    expect(
      within(toolSelect as HTMLElement)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["edit_orders", "list_orders"]);
    expect((toolSelect as HTMLSelectElement).value).toBe("list_orders");
  });

  it("names the widget after the tool, and keeps a name the user typed", () => {
    const updateWidget = vi.fn();
    renderWidget(<McpAppWidget />, {
      updateWidget,
      widgetOverrides: { name: "MCP App", storage: {} },
    });
    fireEvent.click(screen.getByRole("button", { name: "Show app" }));

    const update = updateWidget.mock.calls[0]?.[0] as (
      prev: Partial<WidgetT>,
    ) => WidgetT;
    const fresh = update({ name: "MCP App", storage: {} });
    expect(fresh.name).toBe("Open orders");
    expect(fresh.storage?.mcpApp).toMatchObject({
      toolName: "list_orders",
      autoName: "Open orders",
    });
    expect(update({ name: "My blotter", storage: {} }).name).toBe("My blotter");
  });
});

describe("running an MCP App", () => {
  it("runs a tool that only reads on its own and hands the result to the view", async () => {
    const { bridge } = await renderApp({
      serverUrl: SERVER_URL,
      toolName: "list_orders",
      toolInput: { status: "open" },
    });
    await act(() => bridge.oninitialized());

    expect(bridge.sendToolInput).toHaveBeenCalledWith({
      arguments: { status: "open" },
    });
    expect(callTool).toHaveBeenCalledWith("list_orders", { status: "open" });
    expect(bridge.sendToolResult).toHaveBeenCalled();
  });

  it("runs the first tool once, however often the view says it has started", async () => {
    renderWidget(
      <McpAppWidget />,
      configured({ serverUrl: SERVER_URL, toolName: "edit_orders" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Run" }));
    await waitFor(() => expect(bridges).toHaveLength(1));
    const bridge = bridges[0];

    await act(() => bridge.oninitialized());
    await act(() => bridge.oninitialized());
    await act(() => bridge.oninitialized());
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledWith("edit_orders", undefined);
  });

  it("drops the first tool's result when it comes after the app closed", async () => {
    let finish: (value: unknown) => void = () => {};
    callTool.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { bridge, unmount } = await renderApp();

    let started: Promise<void> = Promise.resolve();
    act(() => {
      started = bridge.oninitialized();
    });
    await waitFor(() => expect(callTool).toHaveBeenCalled());
    unmount();
    finish({ content: [], structuredContent: { rows: ROWS } });
    await act(() => started);

    expect(
      useCopilotDataStore.getState().dashboardWidgetsData["test-uuid"],
    ).toBeUndefined();
    expect(bridge.sendToolResult).not.toHaveBeenCalled();
    expect(bridge.sendToolCancelled).not.toHaveBeenCalled();
  });

  it("waits for Run before a first tool that does not say it only reads", async () => {
    renderWidget(
      <McpAppWidget />,
      configured({ serverUrl: SERVER_URL, toolName: "edit_orders" }),
    );
    const run = await screen.findByRole("button", { name: "Run" });
    expect(bridges).toHaveLength(0);

    fireEvent.click(run);
    await waitFor(() => expect(bridges).toHaveLength(1));
  });

  it("frames the view from this server's own sandbox origin", async () => {
    const { container } = await renderApp();
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    expect(new URL(iframe.src).origin).toMatch(
      /^http:\/\/[0-9a-f]{32}\.sandbox\.localhost:3001$/,
    );
    expect(iframe.getAttribute("sandbox")).toBe(OUTER_SANDBOX);
  });

  it("explains that MCP Apps are not set up without a sandbox address", () => {
    mockConfig.mcpApps.sandboxUrl = "";
    renderWidget(
      <McpAppWidget />,
      configured({ serverUrl: SERVER_URL, toolName: "list_orders" }),
    );
    expect(screen.getByText(/MCP_APPS_SANDBOX_URL is empty/)).toBeInTheDocument();
  });
});

describe("what the host tells the view about itself", () => {
  const lastContext = (bridge: FakeBridge) => bridge.setHostContext.mock.lastCall?.[0];

  it("watches the app's box once the app is shown, and tells the view its size", async () => {
    const { bridge, container } = await renderApp();
    const iframe = await waitFor(() => {
      const frame = container.querySelector("iframe");
      expect(frame).not.toBeNull();
      return frame as HTMLIFrameElement;
    });
    const watching = observers.find((o) =>
      o.observed.includes(iframe.parentElement as Element),
    );
    expect(watching).toBeDefined();

    act(() => watching?.resize(400, 300));
    expect(lastContext(bridge)).toMatchObject({
      containerDimensions: { width: 400, height: 300 },
      locale: navigator.language,
      theme: expect.any(String),
      displayMode: "inline",
    });
  });

  it("keeps the rest of the context when the theme changes", async () => {
    act(() => useThemeStore.setState({ theme: "light" }));
    const { bridge, container } = await renderApp();
    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull());
    act(() => observers.at(-1)?.resize(400, 300));

    act(() => useThemeStore.setState({ theme: "dark" }));
    expect(lastContext(bridge)).toMatchObject({
      theme: "dark",
      containerDimensions: { width: 400, height: 300 },
      locale: navigator.language,
      timeZone: expect.any(String),
    });
  });
});

describe("when the server is not connected", () => {
  const setConnection = (state: string) =>
    useMcpToolsStore.setState((s) => ({
      mcpConnectionRegistry: {
        ...s.mcpConnectionRegistry,
        orders: { ...s.mcpConnectionRegistry.orders, state },
      } as never,
    }));
  const renderOrders = () =>
    renderWidget(
      <McpAppWidget />,
      configured({ serverUrl: SERVER_URL, toolName: "list_orders" }),
    );

  afterEach(() => vi.useRealTimers());

  it("leaves a server the user switched off switched off", () => {
    vi.useFakeTimers();
    setServers([{ ...ordersServer, enabled: false }]);
    setConnection("disconnected");
    const updateServer = vi
      .spyOn(useMcpToolsStore.getState(), "updateServer")
      .mockImplementation(() => {});
    renderOrders();

    act(() => vi.advanceTimersByTime(60_000));
    expect(updateServer).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Orders is switched off in the MCP settings/),
    ).toBeInTheDocument();
  });

  it("turns the server on only when the user asks", () => {
    setServers([{ ...ordersServer, enabled: false }]);
    setConnection("disconnected");
    const updateServer = vi
      .spyOn(useMcpToolsStore.getState(), "updateServer")
      .mockImplementation(() => {});
    renderOrders();

    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    expect(updateServer).toHaveBeenCalledWith("orders", { enabled: true });
  });

  it("retries a connection that failed, on its own and when the user asks", () => {
    vi.useFakeTimers();
    setConnection("failed");
    const updateServer = vi.spyOn(useMcpToolsStore.getState(), "updateServer");
    renderOrders();

    act(() => vi.advanceTimersByTime(2_000));
    expect(retry).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(2);
    expect(updateServer).not.toHaveBeenCalled();
  });
});

describe("what the view may ask of the host", () => {
  it("refuses tools the app may not call", async () => {
    const { bridge } = await renderApp();
    for (const name of ["rank_orders", "cancel_order", "no_such_tool"]) {
      await expect(bridge.oncalltool({ name, arguments: {} })).rejects.toMatchObject({
        code: HOST_REFUSAL_CODE,
      });
    }
    expect(callTool).not.toHaveBeenCalled();
  });

  it("runs a tool that only reads without asking", async () => {
    const { bridge } = await renderApp();
    await act(() => bridge.oncalltool({ name: "get_order", arguments: { id: "O1" } }));
    expect(callTool).toHaveBeenCalledWith("get_order", { id: "O1" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("runs a tool that can change data only once the user allows it", async () => {
    const { bridge } = await renderApp();
    let result: Promise<unknown> = Promise.resolve();
    act(() => {
      result = bridge.oncalltool({
        name: "book_order",
        arguments: { id: "O9", qty: 5 },
      });
    });

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Allow this app to run book_order?");
    expect(dialog).toHaveTextContent('"qty": 5');
    expect(callTool).not.toHaveBeenCalled();

    letConsentArm();
    fireEvent.click(within(dialog).getByRole("button", { name: "Allow once" }));
    await act(() => result);
    expect(callTool).toHaveBeenCalledWith("book_order", { id: "O9", qty: 5 });
  });

  it("does not let a double-click on Allow allow the next call too", async () => {
    const { bridge } = await renderApp();
    let second: Promise<unknown> = Promise.resolve();
    act(() => {
      void bridge.oncalltool({ name: "book_order", arguments: { id: "A" } });
      second = bridge.oncalltool({ name: "book_order", arguments: { id: "B" } });
    });
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent('"id": "A"');

    letConsentArm();
    const allow = () => screen.getByRole("button", { name: "Allow once" });
    fireEvent.click(allow());
    fireEvent.click(allow());
    await waitFor(() => expect(callTool).toHaveBeenCalledTimes(1));
    expect(callTool).toHaveBeenCalledWith("book_order", { id: "A" });
    expect(screen.getByRole("dialog")).toHaveTextContent('"id": "B"');

    letConsentArm();
    fireEvent.click(allow());
    await act(() => second);
    expect(callTool).toHaveBeenLastCalledWith("book_order", { id: "B" });
  });

  it("refuses a tool that can change data when the user denies it", async () => {
    const { bridge } = await renderApp();
    let result: Promise<unknown> = Promise.resolve();
    act(() => {
      result = bridge.oncalltool({ name: "book_order", arguments: {} });
    });
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Deny" }));

    await expect(result).rejects.toMatchObject({ code: HOST_REFUSAL_CODE });
    expect(callTool).not.toHaveBeenCalled();
  });

  it("refuses a call still waiting for the user when the app closes", async () => {
    const { bridge, unmount } = await renderApp();
    let result: Promise<unknown> = Promise.resolve();
    act(() => {
      result = bridge.oncalltool({ name: "book_order", arguments: {} });
    });
    await screen.findByRole("dialog");
    unmount();

    await expect(result).rejects.toMatchObject({ code: HOST_REFUSAL_CODE });
    expect(callTool).not.toHaveBeenCalled();
  });

  it("opens web links only", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { bridge } = await renderApp();

    await expect(
      bridge.onopenlink({ url: "javascript:alert(1)" }),
    ).rejects.toMatchObject({
      code: HOST_REFUSAL_CODE,
    });
    await bridge.onopenlink({ url: "https://example.com/order/O1" });
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(
      "https://example.com/order/O1",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("refuses every request once the app is closing", async () => {
    const { bridge, unmount } = await renderApp();
    unmount();
    await expect(bridge.onlistresources({})).rejects.toMatchObject({
      code: HOST_REFUSAL_CODE,
    });
    await expect(bridge.oncalltool({ name: "get_order" })).rejects.toMatchObject({
      code: HOST_REFUSAL_CODE,
    });
  });
});

describe("what the chat learns from the view", () => {
  const widgetData = () =>
    useCopilotDataStore.getState().dashboardWidgetsData["test-uuid"];

  it("keeps the rows the view shows, and their version while they stay the same", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    const { bridge } = await renderApp();

    await act(() =>
      bridge.onupdatemodelcontext({
        structuredContent: { rowData: ROWS },
        content: [{ type: "text", text: "1 order shown" }],
      }),
    );
    expect(widgetData()?.data).toEqual(ROWS);
    expect(widgetData()?.metadata).toMatchObject({
      data_version: 1000,
      view_summary: "1 order shown",
    });

    now.mockReturnValue(2000);
    await act(() =>
      bridge.onupdatemodelcontext({ structuredContent: { rowData: ROWS } }),
    );
    expect(widgetData()?.metadata?.data_version).toBe(1000);

    await act(() =>
      bridge.onupdatemodelcontext({ structuredContent: { rowData: [{ id: "O2" }] } }),
    );
    expect(widgetData()?.metadata?.data_version).toBe(2000);
  });

  it("tells the chat nothing from a widget kept out of its context", async () => {
    const { bridge } = await renderApp(undefined, { disableRetrievalForCopilot: true });
    await act(() =>
      bridge.onupdatemodelcontext({ structuredContent: { rowData: ROWS } }),
    );
    expect(widgetData()).toBeUndefined();
  });

  it("forgets what the view told the chat when the widget goes", async () => {
    const { bridge, unmount } = await renderApp();
    await act(() =>
      bridge.onupdatemodelcontext({ structuredContent: { rowData: ROWS } }),
    );
    expect(widgetData()).toBeDefined();

    unmount();
    expect(widgetData()).toBeUndefined();
  });
});
