import { fireEvent, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import HtmlViewer from "~/components/Widgets/custom/HtmlViewer";
import type { useJsonData } from "~/lib/api";
import type { Group, Item } from "~/lib/state/app";
import { mockConfig } from "../../../../mocks/runtimeConfig";
import { makeItem, makeParamGroup, nthLastCall } from "../../../factories";
import { renderWidget } from "../WidgetTestWrapper";

type JsonDataResult = ReturnType<typeof useJsonData>;

/** A query result with only the fields the widget reads. */
const jsonData = (
  result: Partial<
    Pick<JsonDataResult, "data" | "isLoading" | "error" | "dataUpdatedAt">
  >,
): JsonDataResult => result as JsonDataResult;

/** The `raw` query value of the request a useJsonData call was given. */
const rawQueryValue = (options: Parameters<typeof useJsonData>[0]) =>
  options.request?.ok
    ? new URL(options.request.request.url).searchParams.get("raw")
    : null;

const appStoreMock = vi.hoisted(() => ({
  getWidgetGroups: vi.fn<(tabId: string, widgetId: string | undefined) => Group[]>(
    () => [],
  ),
  getTabById: vi.fn<(id: string) => Item | undefined>(() => undefined),
  updateGroup: vi.fn(),
}));

const sharedAppStoreMock = vi.hoisted(() => ({
  getDashboardById: vi.fn<(id: string) => Item | undefined>(() => undefined),
  getWidgetGroups: vi.fn<(tabId: string, widgetId: string | undefined) => Group[]>(
    () => [],
  ),
}));

vi.mock("~/components/DraggableCard", () => ({
  default: ({
    children,
    loading,
    error,
    extraNavbarElements,
  }: {
    children?: ReactNode;
    loading?: boolean;
    error?: boolean;
    extraNavbarElements?: ReactNode;
  }) => (
    <div data-testid="draggable-card">
      {extraNavbarElements}
      {loading && <span data-testid="loading">Loading...</span>}
      {error && <span data-testid="error">Error</span>}
      {children}
    </div>
  ),
}));

vi.mock("~/lib/api", () => ({
  useJsonData: vi.fn(() => ({
    data: "<div>Test HTML Content</div>",
    isLoading: false,
    error: null,
    dataUpdatedAt: Date.now(),
  })),
}));

vi.mock("~/lib/state/app", () => ({
  useShallowAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      getWidgetGroups: appStoreMock.getWidgetGroups,
      getTabById: appStoreMock.getTabById,
      updateGroup: appStoreMock.updateGroup,
    }),
}));

vi.mock("~/lib/state/sharedApp", () => ({
  useShallowSharedAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      getDashboardById: sharedAppStoreMock.getDashboardById,
      getWidgetGroups: sharedAppStoreMock.getWidgetGroups,
    }),
}));

vi.mock("~/components/WidgetParams/QueryParams", () => ({
  useWidgetParamsPositions: () => ({
    renderRow0Params: null,
    renderBelowNavbarRows: null,
  }),
}));

describe("HtmlViewer Widget", () => {
  it("renders HTML viewer container", () => {
    renderWidget(<HtmlViewer />, {
      widgetOverrides: {
        endpoint: { url: "https://api.example.com/html" },
        storage: { params: {} },
      },
    });

    expect(screen.getByTestId("draggable-card")).toBeInTheDocument();
  });
});

describe("HtmlViewer - Loading State", () => {
  it("shows loading state", async () => {
    const { useJsonData } = vi.mocked(await import("~/lib/api"));
    useJsonData.mockReturnValue(
      jsonData({
        data: undefined,
        isLoading: true,
        error: null,
        dataUpdatedAt: Date.now(),
      }),
    );

    renderWidget(<HtmlViewer />, {
      widgetOverrides: {
        endpoint: { url: "https://api.example.com/html" },
        storage: { params: {} },
      },
    });

    expect(screen.getByTestId("loading")).toBeInTheDocument();
  });
});

describe("HtmlViewer - raw data query", () => {
  const HTML_DATA_UPDATED_AT = 1720000000000;

  beforeEach(async () => {
    const { useJsonData } = vi.mocked(await import("~/lib/api"));
    useJsonData.mockClear();
    useJsonData.mockReturnValue(
      jsonData({
        data: "<div>html</div>",
        isLoading: false,
        error: null,
        dataUpdatedAt: HTML_DATA_UPDATED_AT,
      }),
    );
  });

  it("uses a stale raw query so entering raw view refetches the endpoint", async () => {
    const { useJsonData } = vi.mocked(await import("~/lib/api"));

    renderWidget(<HtmlViewer />, {
      widgetOverrides: {
        id: "html-raw",
        raw: true,
        endpoint: { url: "https://api.example.com/html" },
        storage: { params: {} },
      },
    });

    // The second useJsonData call is the raw-data query
    const [rawOptions, rawQueryOptions] = nthLastCall(useJsonData);
    expect(rawQueryValue(rawOptions)).toBe("true");
    expect(rawOptions.queryKey).toBeUndefined();
    expect(rawQueryOptions?.staleTime).toBe(0);
  });

  it("does not share the html run-button query key with the raw query", async () => {
    const { useJsonData } = vi.mocked(await import("~/lib/api"));

    renderWidget(<HtmlViewer />, {
      widgetOverrides: {
        id: "html-raw-run",
        raw: true,
        runButton: true,
        endpoint: { url: "https://api.example.com/html" },
        storage: { params: {} },
      },
    });

    const htmlOptions = nthLastCall(useJsonData, 2)[0];
    const rawOptions = nthLastCall(useJsonData)[0];
    expect(htmlOptions.queryKey).toBeDefined();
    expect(rawOptions.queryKey).toBeUndefined();
  });

  it("requests raw data in raw view and keeps showing the HTML", async () => {
    const { useJsonData } = vi.mocked(await import("~/lib/api"));

    renderWidget(<HtmlViewer />, {
      widgetOverrides: {
        id: "html-raw-view",
        name: "Raw Widget",
        raw: true,
        endpoint: { url: "https://api.example.com/html" },
        storage: { params: {}, rawDataView: true },
      },
    });

    const htmlQueryOptions = nthLastCall(useJsonData, 2)[1];
    const [rawOptions, rawQueryOptions] = nthLastCall(useJsonData);
    expect(htmlQueryOptions?.enabled).toBe(true);
    expect(rawQueryValue(rawOptions)).toBe("true");
    expect(rawQueryOptions?.enabled).toBe(true);
    expect(screen.getByTitle("Raw Widget")).toHaveAttribute(
      "srcdoc",
      expect.stringContaining("<div>html</div>"),
    );
  });

  it("toggles the raw data view from the navbar button", () => {
    const updateWidget = vi.fn();

    renderWidget(<HtmlViewer />, {
      updateWidget,
      widgetOverrides: {
        id: "html-raw-toggle",
        raw: true,
        endpoint: { url: "https://api.example.com/html" },
        storage: { params: {} },
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Switch to raw data view" }));

    const update = updateWidget.mock.calls.at(-1)?.[0];
    expect(update({ storage: {} }).storage.rawDataView).toBe(true);
  });

  it("has no raw data toggle when the widget does not declare raw", () => {
    renderWidget(<HtmlViewer />, {
      widgetOverrides: {
        id: "html-no-raw",
        endpoint: { url: "https://api.example.com/html" },
        storage: { params: {} },
      },
    });

    expect(
      screen.queryByRole("button", { name: "Switch to raw data view" }),
    ).not.toBeInTheDocument();
  });
});

describe("HtmlViewer - iframe params bridge", () => {
  const BRIDGE_UUID = "11111111-1111-1111-1111-111111111111";
  const FULL_TOKEN = `html-${BRIDGE_UUID}`;

  beforeAll(() => {
    mockConfig.data.allowHtmlJsExecution = true;
    vi.spyOn(crypto, "randomUUID").mockReturnValue(BRIDGE_UUID);
  });

  afterAll(() => {
    mockConfig.data.allowHtmlJsExecution = false;
    vi.restoreAllMocks();
  });

  beforeEach(async () => {
    const { useJsonData } = vi.mocked(await import("~/lib/api"));
    useJsonData.mockClear();
    useJsonData.mockReturnValue(
      jsonData({
        data: "<html><body><p>hi</p></body></html>",
        isLoading: false,
        error: null,
        dataUpdatedAt: Date.now(),
      }),
    );
    appStoreMock.getWidgetGroups.mockReturnValue([]);
    appStoreMock.getTabById.mockReturnValue(undefined);
    appStoreMock.updateGroup.mockReset();
    sharedAppStoreMock.getDashboardById.mockReturnValue(undefined);
    sharedAppStoreMock.getWidgetGroups.mockReturnValue([]);
  });

  it("includes storage params in the run-button html query key", async () => {
    const { useJsonData } = vi.mocked(await import("~/lib/api"));

    renderWidget(<HtmlViewer />, {
      widgetOverrides: {
        id: "market-filters",
        runButton: true,
        endpoint: { url: "https://api.example.com/html" },
        storage: { params: { use_categories: "correctional_facilities" } },
        params: [{ paramName: "use_categories" }],
      },
    });

    // The html query is the one before the raw-data query
    const [options] = nthLastCall(useJsonData, 2);
    expect(options.queryKey).toContain(
      "https://api.example.com/html?use_categories=correctional_facilities&theme=dark",
    );
  });

  it("updates widget storage when a bridge-tokened params message arrives", () => {
    const updateWidget = vi.fn();
    renderWidget(<HtmlViewer />, {
      updateWidget,
      widgetOverrides: {
        id: "html-1",
        endpoint: { url: "https://api.example.com/html" },
        storage: { params: {} },
        params: [{ paramName: "event_ticker" }, { paramName: "limit" }],
      },
    });

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "workspace:widget-params:update",
          params: { event_ticker: "KXSB-27", limit: 40 },
          widgetParamBridgeToken: FULL_TOKEN,
        },
      }),
    );

    expect(updateWidget).toHaveBeenCalled();
    const [updater] = updateWidget.mock.calls.at(-1) ?? [];
    const next = updater({ storage: { params: { existing: "x" } } });
    expect(next.storage.params).toEqual({
      existing: "x",
      event_ticker: "KXSB-27",
      limit: 40,
    });
    expect(next.refreshQuery).toBeUndefined();
  });

  it("fires the per-widget updateQueryParams custom event with the filtered params", () => {
    const handler = vi.fn();
    window.addEventListener("updateQueryParams-html-evt", handler as EventListener);

    renderWidget(<HtmlViewer />, {
      widgetOverrides: {
        id: "html-evt",
        endpoint: { url: "https://api.example.com/html" },
        storage: { params: {} },
        params: [{ paramName: "ticker" }],
      },
    });

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "workspace:params:update",
          paramName: "ticker",
          value: "AAPL",
          widgetParamBridgeToken: FULL_TOKEN,
        },
      }),
    );

    expect(handler).toHaveBeenCalled();
    const detail = (handler.mock.calls.at(-1)?.[0] as CustomEvent).detail;
    expect(detail).toEqual({ ticker: "AAPL" });

    window.removeEventListener("updateQueryParams-html-evt", handler as EventListener);
  });

  it("runs the widget's scripts in an opaque origin, apart from the page", () => {
    renderWidget(<HtmlViewer />, {
      widgetOverrides: {
        id: "html-sandbox",
        endpoint: { url: "https://api.example.com/html" },
      },
    });

    const sandbox = document.querySelector("iframe")?.getAttribute("sandbox") ?? "";
    expect(sandbox.split(" ")).toContain("allow-scripts");
    expect(sandbox.split(" ")).not.toContain("allow-same-origin");
  });

  it("updates matching dashboard param groups from nested widget params", () => {
    appStoreMock.getWidgetGroups.mockReturnValue([
      makeParamGroup({ id: "sectors-group", groupById: "sectors", value: "" }),
      makeParamGroup({
        id: "proceeds-group",
        groupById: "uses_of_proceeds",
        value: "",
      }),
    ]);

    renderWidget(<HtmlViewer />, {
      activeDashboardId: "market-dashboard",
      widgetOverrides: {
        id: "market-filters",
        endpoint: { url: "https://api.example.com/html" },
        storage: { params: {} },
        params: [{ paramName: "sectors" }, { paramName: "uses_of_proceeds" }],
      },
    });

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "workspace:widget-params:update",
          params: { sectors: "education,government" },
          widgetParamBridgeToken: FULL_TOKEN,
        },
      }),
    );

    expect(appStoreMock.updateGroup).toHaveBeenCalledTimes(1);
    expect(appStoreMock.updateGroup).toHaveBeenCalledWith(
      "market-dashboard",
      "sectors-group",
      makeParamGroup({
        id: "sectors-group",
        groupById: "sectors",
        value: "education,government",
      }),
    );
  });

  it("updates matching dashboard param groups even when the html widget is not linked", () => {
    appStoreMock.getTabById.mockReturnValue(
      makeItem({
        index: "market-dashboard",
        data: {
          groups: [
            makeParamGroup({
              id: "proceeds-group",
              groupById: "uses_of_proceeds",
              value: "",
            }),
            makeParamGroup({ id: "unrelated-group", groupById: "states", value: "" }),
          ],
        },
      }),
    );

    renderWidget(<HtmlViewer />, {
      activeDashboardId: "market-dashboard",
      widgetOverrides: {
        id: "market-filters",
        endpoint: { url: "https://api.example.com/html" },
        storage: { params: {} },
        params: [{ paramName: "uses_of_proceeds" }],
      },
    });

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "workspace:widget-params:update",
          params: { uses_of_proceeds: "correctional_facilities" },
          widgetParamBridgeToken: FULL_TOKEN,
        },
      }),
    );

    expect(appStoreMock.updateGroup).toHaveBeenCalledTimes(1);
    expect(appStoreMock.updateGroup).toHaveBeenCalledWith(
      "market-dashboard",
      "proceeds-group",
      makeParamGroup({
        id: "proceeds-group",
        groupById: "uses_of_proceeds",
        value: "correctional_facilities",
      }),
    );
  });

  it("updates groups using stored params plus the iframe changed param", () => {
    appStoreMock.getTabById.mockReturnValue(
      makeItem({
        index: "market-dashboard",
        data: {
          groups: [
            makeParamGroup({ id: "sectors-group", groupById: "sectors", value: "" }),
            makeParamGroup({
              id: "proceeds-group",
              groupById: "uses_of_proceeds",
              value: "",
            }),
          ],
        },
      }),
    );

    renderWidget(<HtmlViewer />, {
      activeDashboardId: "market-dashboard",
      widgetOverrides: {
        id: "market-filters",
        endpoint: { url: "https://api.example.com/html" },
        storage: {
          params: {
            sectors: "education,government",
            uses_of_proceeds: "correctional_facilities",
          },
        },
        params: [{ paramName: "sectors" }, { paramName: "uses_of_proceeds" }],
      },
    });

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "workspace:widget-params:update",
          params: { uses_of_proceeds: "police" },
          widgetParamBridgeToken: FULL_TOKEN,
        },
      }),
    );

    expect(appStoreMock.updateGroup).toHaveBeenCalledTimes(2);
    expect(appStoreMock.updateGroup).toHaveBeenCalledWith(
      "market-dashboard",
      "sectors-group",
      makeParamGroup({
        id: "sectors-group",
        groupById: "sectors",
        value: "education,government",
      }),
    );
    expect(appStoreMock.updateGroup).toHaveBeenCalledWith(
      "market-dashboard",
      "proceeds-group",
      makeParamGroup({
        id: "proceeds-group",
        groupById: "uses_of_proceeds",
        value: "police",
      }),
    );
  });

  it("drops params not declared on the widget", () => {
    const updateWidget = vi.fn();
    renderWidget(<HtmlViewer />, {
      updateWidget,
      widgetOverrides: {
        id: "html-2",
        endpoint: { url: "https://api.example.com/html" },
        storage: { params: {} },
        params: [{ paramName: "ticker" }],
      },
    });

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "workspace:widget-params:update",
          params: { ticker: "AAPL", secret_field: "leaked" },
          widgetParamBridgeToken: FULL_TOKEN,
        },
      }),
    );

    expect(updateWidget).toHaveBeenCalledTimes(1);
    const [updater] = updateWidget.mock.calls.at(-1) ?? [];
    const next = updater({ storage: { params: {} } });
    expect(next.storage.params).toEqual({ ticker: "AAPL" });
    expect(next.storage.params).not.toHaveProperty("secret_field");
  });

  it("ignores messages that match neither event.source nor the bridge token", () => {
    const updateWidget = vi.fn();
    renderWidget(<HtmlViewer />, {
      updateWidget,
      widgetOverrides: {
        id: "html-3",
        endpoint: { url: "https://api.example.com/html" },
        storage: { params: {} },
        params: [{ paramName: "ticker" }],
      },
    });

    window.dispatchEvent(
      new MessageEvent("message", {
        // Source is this top-level window, not the iframe's contentWindow,
        // and no bridge token is included.
        source: window,
        data: {
          type: "workspace:widget-params:update",
          params: { ticker: "AAPL" },
        },
      }),
    );

    expect(updateWidget).not.toHaveBeenCalled();
  });

  it("ignores non-params message types even when the token matches", () => {
    const updateWidget = vi.fn();
    renderWidget(<HtmlViewer />, {
      updateWidget,
      widgetOverrides: {
        id: "html-4",
        endpoint: { url: "https://api.example.com/html" },
        storage: { params: {} },
        params: [{ paramName: "ticker" }],
      },
    });

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "workspace-data",
          widgetId: "html-4",
          dataType: "table",
          data: [],
          widgetParamBridgeToken: FULL_TOKEN,
        },
      }),
    );

    expect(updateWidget).not.toHaveBeenCalled();
  });

  it("injects the bridge script immediately after <body> in iframe srcdoc", () => {
    renderWidget(<HtmlViewer />, {
      widgetOverrides: {
        endpoint: { url: "https://api.example.com/html" },
        storage: { params: {} },
        params: [],
      },
    });

    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    const srcdoc = iframe?.getAttribute("srcdoc") ?? "";
    expect(srcdoc).toMatch(/<body><script>/i);
    expect(srcdoc).toContain(BRIDGE_UUID);
    expect(srcdoc).toContain("workspace:widget-params:update");
  });
});
