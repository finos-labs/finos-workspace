import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Group, WidgetT } from "~/components/types";

vi.mock("react-router-dom", () => ({
  useParams: () => ({ id: "dashboard-123" }),
  useSearchParams: () => [new URLSearchParams()],
}));

const mockGetLastInnerTab = vi.fn().mockReturnValue("");
const mockGetSideBarItem = vi.fn();
const mockGetWidgetGroups = vi.fn().mockReturnValue([]);
const mockGetTabById = vi.fn().mockReturnValue(undefined);

vi.mock("~/lib/state/app", () => ({
  useAppStore: {
    getState: () => ({
      getSideBarItem: mockGetSideBarItem,
      getWidgetGroups: mockGetWidgetGroups,
      items: new Proxy({} as Record<string, unknown>, {
        get: (_target, key: string) => mockGetSideBarItem(key),
      }),
    }),
  },
  useShallowAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      getLastInnerTab: mockGetLastInnerTab,
      getSideBarItem: mockGetSideBarItem,
      getTabById: mockGetTabById,
    }),
}));

vi.mock("~/lib/state/auth", () => ({
  useShallowAuthStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ lastVisitedPage: "/app" }),
  useAuthStore: () => ({ getState: () => ({}) }),
}));

const mockGetDashboardWidgetData = vi.fn().mockReturnValue(null);
const mockGetDashboardWidgetsData = vi.fn().mockReturnValue({});
const mockGetWidgetRuntimeState = vi.fn().mockReturnValue(undefined);
const mockGetWidgetsInCurrentDashboard = vi.fn().mockReturnValue([]);
const mockSetCopilotWidgets = vi.fn();

vi.mock("~/lib/state/copilotData", () => ({
  useShallowCopilotDataStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      selectedWidgetIDs: [],
      getDashboardWidgetData: mockGetDashboardWidgetData,
      getDashboardWidgetsData: mockGetDashboardWidgetsData,
      getWidgetRuntimeState: mockGetWidgetRuntimeState,
      widgetSubsetData: null,
      widgetsLastUpdated: 0,
      getWidgetsInCurrentDashboard: mockGetWidgetsInCurrentDashboard,
      setCopilotWidgets: mockSetCopilotWidgets,
      copilotWidgets: { selectedWidgets: [] },
    }),
}));

const copilotTestState = vi.hoisted(() => ({
  features: {
    "widget-dashboard-select": true,
    "widget-dashboard-search": false,
    "file-upload": false,
  } as Record<string, boolean>,
  messages: undefined as Message[] | undefined,
  files: [] as CopilotFile[],
}));

vi.mock("~/lib/state/copilot", () => ({
  useShallowCopilotStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      selectedCopilot: {
        id: "copilot-1",
        features: copilotTestState.features,
      },
      getCurrentChat: () => ({ messages: copilotTestState.messages }),
      getCurrentChatArtifacts: vi.fn(),
      orchestrationModeEnabled: false,
      agentOrchestrationMap: {},
      externalCopilotHolders: [],
      actionHistory: [],
    }),
}));

vi.mock("~/components/AI/hooks/useWidgetsInCurrentDashboard", () => ({
  useWidgetsInCurrentDashboard: () => vi.fn(),
  useSyncWidgetsInCurrentDashboard: vi.fn(),
}));

vi.mock("~/components/AI/hooks/useGetAppWidgets", () => ({
  useShallowAppWidgetsStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      lastUpdated: 0,
      getAppWidget: vi.fn().mockReturnValue(null),
      getAllAppWidgets: vi.fn().mockReturnValue([]),
    }),
}));

vi.mock("~/components/AI/hooks/useStreaming", () => ({
  useShallowStreamingStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ files: copilotTestState.files }),
}));

vi.mock("~/components/AI/hooks/useTextSuggestions", () => ({
  useTextSuggestions: vi.fn(),
}));

vi.mock("~/components/Widgets/Helpers/useCopilotDataWidget", () => ({
  createCopilotDataWidget: vi.fn().mockReturnValue({
    metadata: {},
    title: "Mock",
  }),
}));

const { mockGetWidgetInfo, mockCreateParamDefs, mockCurrentDateModifier } = vi.hoisted(
  () => ({
    mockGetWidgetInfo: vi.fn().mockReturnValue(null),
    mockCreateParamDefs: vi.fn().mockReturnValue([]),
    mockCurrentDateModifier: vi.fn().mockImplementation((v: unknown) => v),
  }),
);

vi.mock("~/lib/utils", () => ({
  createParamDefs: mockCreateParamDefs,
  currentDateModifier: mockCurrentDateModifier,
  getEndpointParamName: vi.fn(),
  getJsonWidget: vi.fn(),
  getWidgetDataSource: vi.fn().mockReturnValue("unknown"),
  getWidgetInfo: mockGetWidgetInfo,
}));

import {
  createCopilotWidget,
  useGetCopilotWidgets,
} from "~/components/AI/hooks/useGetCopilotWidgets";
import {
  registerIframeWidget,
  unregisterIframeWidget,
} from "~/lib/iframeWidgetRegistry";
import type { CopilotFile, HumanMessage, Message } from "~/lib/state/copilot";

function createWidget(overrides: Partial<WidgetT> & { id: string }): WidgetT {
  return {
    name: "Test Widget",
    description: "",
    widgetId: "html",
    type: "html",
    params: [],
    storage: {},
    data: {},
    ...overrides,
  } as WidgetT;
}

describe("useGetCopilotWidgets - nav bar tab mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWidgetInfo.mockReturnValue({
      name: "Test Widget",
      description: "Test description",
      source: "test-source",
      category: "Test",
      subCategory: "Test",
    });
    mockGetSideBarItem.mockImplementation(() => ({
      data: {
        name: "Test Dashboard",
        widgets: mockGetWidgetsInCurrentDashboard(),
        currentTab: mockGetLastInnerTab(),
        gridLayout: {},
      },
    }));
  });

  it("should use display names from navigation_bar tabs instead of slugs", () => {
    const widgets = [
      createWidget({
        id: "nav-1",
        widgetId: "navigation_bar",
        storage: {
          tabs: [
            { id: "overview", name: "Overview" },
            { id: "detailed-charts", name: "Detailed Charts" },
          ],
        },
      }),
      createWidget({
        id: "w-1",
        widgetId: "html",
        name: "AAPL Chart",
        innerTab: "overview",
      }),
      createWidget({
        id: "w-2",
        widgetId: "html",
        name: "MSFT Chart",
        innerTab: "detailed-charts",
      }),
    ];

    mockGetWidgetsInCurrentDashboard.mockReturnValue(widgets);
    mockGetDashboardWidgetsData.mockReturnValue({
      "w-1": { metadata: {}, title: "AAPL Chart" },
      "w-2": { metadata: {}, title: "MSFT Chart" },
    });

    renderHook(() => useGetCopilotWidgets());

    const setCopilotCall = mockSetCopilotWidgets.mock.calls[0]?.[0];
    const dashboardInfo = setCopilotCall?.workspaceState?.current_dashboard_info;

    expect(dashboardInfo).not.toBeNull();
    const tabNames = dashboardInfo.tabs.map((t: { tab_name: string }) => t.tab_name);
    expect(tabNames).toContain("Overview");
    expect(tabNames).toContain("Detailed Charts");
    expect(
      dashboardInfo.tabs.find((t: { tab_id: string }) => t.tab_id === "overview"),
    ).toBeDefined();
    expect(
      dashboardInfo.tabs.find(
        (t: { tab_id: string }) => t.tab_id === "detailed-charts",
      ),
    ).toBeDefined();
  });

  it("should seed empty tabs from navigation_bar so AI can see them", () => {
    const widgets = [
      createWidget({
        id: "nav-1",
        widgetId: "navigation_bar",
        storage: {
          tabs: [
            { id: "overview", name: "Overview" },
            { id: "empty-tab", name: "Empty Tab" },
          ],
        },
      }),
      createWidget({
        id: "w-1",
        widgetId: "html",
        name: "AAPL Chart",
        innerTab: "overview",
      }),
    ];

    mockGetWidgetsInCurrentDashboard.mockReturnValue(widgets);
    mockGetDashboardWidgetsData.mockReturnValue({
      "w-1": { metadata: {}, title: "AAPL Chart" },
    });

    renderHook(() => useGetCopilotWidgets());

    const setCopilotCall = mockSetCopilotWidgets.mock.calls[0]?.[0];
    const dashboardInfo = setCopilotCall?.workspaceState?.current_dashboard_info;

    expect(dashboardInfo).not.toBeNull();
    const emptyTab = dashboardInfo.tabs.find(
      (t: { tab_name: string }) => t.tab_name === "Empty Tab",
    );
    expect(emptyTab).toBeDefined();
    expect(emptyTab.widgets).toEqual([]);
  });

  it("should use slug as fallback for tabs not in navigation_bar", () => {
    const widgets = [
      createWidget({
        id: "nav-1",
        widgetId: "navigation_bar",
        storage: {
          tabs: [{ id: "overview", name: "Overview" }],
        },
      }),
      createWidget({
        id: "w-1",
        widgetId: "html",
        name: "Orphan Widget",
        innerTab: "unknown-tab",
      }),
    ];

    mockGetWidgetsInCurrentDashboard.mockReturnValue(widgets);
    mockGetDashboardWidgetsData.mockReturnValue({
      "w-1": { metadata: {}, title: "Orphan Widget" },
    });

    renderHook(() => useGetCopilotWidgets());

    const setCopilotCall = mockSetCopilotWidgets.mock.calls[0]?.[0];
    const dashboardInfo = setCopilotCall?.workspaceState?.current_dashboard_info;

    const unknownTab = dashboardInfo.tabs.find(
      (t: { tab_id: string }) => t.tab_id === "unknown-tab",
    );
    expect(unknownTab).toBeDefined();
    expect(unknownTab.widgets).toHaveLength(1);
  });

  it("should resolve current_tab_name to display name", () => {
    mockGetLastInnerTab.mockReturnValue("detailed-charts");

    const widgets = [
      createWidget({
        id: "nav-1",
        widgetId: "navigation_bar",
        storage: {
          tabs: [
            { id: "overview", name: "Overview" },
            { id: "detailed-charts", name: "Detailed Charts" },
          ],
        },
      }),
    ];

    mockGetWidgetsInCurrentDashboard.mockReturnValue(widgets);
    mockGetDashboardWidgetsData.mockReturnValue({});

    renderHook(() => useGetCopilotWidgets());

    const setCopilotCall = mockSetCopilotWidgets.mock.calls[0]?.[0];
    const dashboardInfo = setCopilotCall?.workspaceState?.current_dashboard_info;

    expect(dashboardInfo.current_tab_id).toBe("detailed-charts");
    expect(dashboardInfo.current_tab_name).toBe("Detailed Charts");
  });

  it("should handle missing storage.tabs gracefully", () => {
    const widgets = [
      createWidget({
        id: "nav-1",
        widgetId: "navigation_bar",
        storage: {},
      }),
      createWidget({
        id: "w-1",
        widgetId: "html",
        name: "Widget",
        innerTab: "some-tab",
      }),
    ];

    mockGetWidgetsInCurrentDashboard.mockReturnValue(widgets);
    mockGetDashboardWidgetsData.mockReturnValue({
      "w-1": { metadata: {}, title: "Widget" },
    });

    renderHook(() => useGetCopilotWidgets());

    const setCopilotCall = mockSetCopilotWidgets.mock.calls[0]?.[0];
    const dashboardInfo = setCopilotCall?.workspaceState?.current_dashboard_info;

    expect(dashboardInfo).not.toBeNull();
    const tab = dashboardInfo.tabs.find(
      (t: { tab_id: string }) => t.tab_id === "some-tab",
    );
    expect(tab).toBeDefined();
  });

  it("should handle dashboard with no navigation_bar widget", () => {
    const widgets = [
      createWidget({
        id: "w-1",
        widgetId: "html",
        name: "Widget A",
      }),
      createWidget({
        id: "w-2",
        widgetId: "html",
        name: "Widget B",
      }),
    ];

    mockGetWidgetsInCurrentDashboard.mockReturnValue(widgets);
    mockGetDashboardWidgetsData.mockReturnValue({
      "w-1": { metadata: {}, title: "Widget A" },
      "w-2": { metadata: {}, title: "Widget B" },
    });

    renderHook(() => useGetCopilotWidgets());

    const setCopilotCall = mockSetCopilotWidgets.mock.calls[0]?.[0];
    const dashboardInfo = setCopilotCall?.workspaceState?.current_dashboard_info;

    expect(dashboardInfo).not.toBeNull();
    const noTab = dashboardInfo.tabs.find(
      (t: { tab_id: string }) => t.tab_id === "__no_tab__",
    );
    expect(noTab).toBeDefined();
    expect(noTab.widgets).toHaveLength(2);
  });

  it("should exclude navigation_bar widget from tab widget lists", () => {
    const widgets = [
      createWidget({
        id: "nav-1",
        widgetId: "navigation_bar",
        storage: {
          tabs: [{ id: "overview", name: "Overview" }],
        },
        innerTab: "overview",
      }),
      createWidget({
        id: "w-1",
        widgetId: "html",
        name: "Chart",
        innerTab: "overview",
      }),
    ];

    mockGetWidgetsInCurrentDashboard.mockReturnValue(widgets);
    mockGetDashboardWidgetsData.mockReturnValue({
      "w-1": { metadata: {}, title: "Chart" },
    });

    renderHook(() => useGetCopilotWidgets());

    const setCopilotCall = mockSetCopilotWidgets.mock.calls[0]?.[0];
    const dashboardInfo = setCopilotCall?.workspaceState?.current_dashboard_info;

    const overviewTab = dashboardInfo.tabs.find(
      (t: { tab_id: string }) => t.tab_id === "overview",
    );
    expect(overviewTab.widgets).toHaveLength(1);
    expect(overviewTab.widgets[0].name).toBe("Chart");
  });
});

describe("useGetCopilotWidgets - temporary file widgets", () => {
  const uploadedFile = (name: string, uuid: string) => ({
    name,
    description: `${name} description`,
    status: "uploaded" as const,
    stored_file_uuid: uuid,
    url: `https://files.test/${uuid}.pdf`,
  });

  const humanMessage = (files: ReturnType<typeof uploadedFile>[]): HumanMessage => ({
    role: "human",
    content: "summarize this",
    copilotId: "copilot-1",
    timestamp: 1,
    files,
  });

  const renderTemporaryWidgets = () => {
    renderHook(() => useGetCopilotWidgets());
    const lastCall = mockSetCopilotWidgets.mock.calls.at(-1)?.[0];
    return lastCall?.temporaryWidgets ?? [];
  };

  beforeEach(() => {
    vi.clearAllMocks();
    copilotTestState.features["file-upload"] = true;
    copilotTestState.files = [];
    copilotTestState.messages = undefined;
    mockGetWidgetsInCurrentDashboard.mockReturnValue([]);
    mockGetSideBarItem.mockReturnValue(null);
  });

  afterEach(() => {
    copilotTestState.features["file-upload"] = false;
    copilotTestState.files = [];
    copilotTestState.messages = undefined;
  });

  it("keeps files attached to earlier messages available as context", () => {
    copilotTestState.messages = [
      humanMessage([uploadedFile("dailyreport.pdf", "uuid-1")]),
    ];

    const temporaryWidgets = renderTemporaryWidgets();

    expect(temporaryWidgets).toHaveLength(1);
    expect(temporaryWidgets[0]).toMatchObject({
      origin: "the backend",
      widget_id: "file-uuid-1",
      name: "dailyreport.pdf",
      metadata: { extension: "pdf" },
    });
  });

  it("does not duplicate a file present in both the composer and a message", () => {
    copilotTestState.files = [uploadedFile("dailyreport.pdf", "uuid-1")];
    copilotTestState.messages = [
      humanMessage([uploadedFile("dailyreport.pdf", "uuid-1")]),
    ];

    expect(renderTemporaryWidgets()).toHaveLength(1);
  });

  it("ignores files that have not finished uploading", () => {
    copilotTestState.files = [
      { name: "pending.pdf", description: "", status: "pending" as const },
    ];

    expect(renderTemporaryWidgets()).toEqual([]);
  });

  it("returns no file widgets for a chat without attachments", () => {
    copilotTestState.messages = [{ ...humanMessage([]), files: undefined }];

    expect(renderTemporaryWidgets()).toEqual([]);
  });

  it("returns no file widgets when the copilot lacks the file-upload feature", () => {
    copilotTestState.features["file-upload"] = false;
    copilotTestState.messages = [
      humanMessage([uploadedFile("dailyreport.pdf", "uuid-1")]),
    ];

    expect(renderTemporaryWidgets()).toEqual([]);
  });
});

describe("createCopilotWidget - runtime state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should include executed_value in params when runtime state has copilotExecutedParams", () => {
    mockGetWidgetInfo.mockReturnValue({
      name: "Test Widget",
      description: "Test description",
      source: "test-source",
    });

    mockCreateParamDefs.mockReturnValue([
      {
        paramName: "query",
        type: "text",
        value: "default query",
      },
    ]);

    const widget = createWidget({
      id: "test-widget",
      widgetId: "html",
      params: [{ paramName: "query", type: "text", value: "default query" }],
    });

    const metadata = {
      params: { query: "current query" },
    };

    const runtimeState = {
      copilotDraftParams: { query: "draft query" },
      copilotExecutedParams: { query: "executed query" },
    };

    const result = createCopilotWidget("test-widget", widget, metadata, runtimeState);

    expect(result).not.toBeNull();
    const queryParam = result?.params?.find(
      (p: { name: string }) => p.name === "query",
    );
    expect(queryParam?.current_value).toBe("draft query");
    expect(queryParam?.executed_value).toBe("executed query");
  });

  it("should use metadata params when runtime state is undefined", () => {
    mockGetWidgetInfo.mockReturnValue({
      name: "Test Widget",
      description: "Test description",
      source: "test-source",
    });

    mockCreateParamDefs.mockReturnValue([
      {
        paramName: "ticker",
        type: "text",
        value: "AAPL",
      },
    ]);

    const widget = createWidget({
      id: "test-widget",
      widgetId: "html",
      params: [{ paramName: "ticker", type: "text", value: "AAPL" }],
    });

    const metadata = {
      params: { ticker: "MSFT" },
    };

    const result = createCopilotWidget("test-widget", widget, metadata, undefined);

    expect(result).not.toBeNull();
    const tickerParam = result?.params?.find(
      (p: { name: string }) => p.name === "ticker",
    );
    expect(tickerParam?.current_value).toBe("MSFT");
    expect(tickerParam?.executed_value).toBeUndefined();
  });

  it("should handle empty runtime state gracefully", () => {
    mockGetWidgetInfo.mockReturnValue({
      name: "Test Widget",
      description: "Test description",
      source: "test-source",
    });

    mockCreateParamDefs.mockReturnValue([
      {
        paramName: "query",
        type: "text",
        value: "default",
      },
    ]);

    const widget = createWidget({
      id: "test-widget",
      widgetId: "html",
      params: [{ paramName: "query", type: "text", value: "default" }],
    });

    const result = createCopilotWidget("test-widget", widget, {}, {});

    expect(result).not.toBeNull();
    const queryParam = result?.params?.find(
      (p: { name: string }) => p.name === "query",
    );
    expect(queryParam?.executed_value).toBeUndefined();
  });
});

describe("createCopilotWidget - grouped parameters", () => {
  const symbolGroup = (value: unknown): Group =>
    ({
      type: "param",
      id: "g-1",
      name: "Symbol",
      color: "#fff",
      groupById: "symbol",
      value,
    }) as Group;

  const iframeWidget = () =>
    createWidget({
      id: "asset-info",
      widgetId: "asset_info",
      type: "iframe",
      params: [
        { paramName: "symbol", type: "text", value: "AAPL" },
        { paramName: "theme", type: "text", value: "dark" },
      ],
    });

  const currentValueOf = (
    result: ReturnType<typeof createCopilotWidget>,
    name: string,
  ) => result?.params?.find((p: { name: string }) => p.name === name)?.current_value;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWidgetInfo.mockReturnValue({ name: "Asset Info", description: "Info" });
    mockCreateParamDefs.mockReturnValue([
      { paramName: "symbol", type: "text", value: "AAPL" },
      { paramName: "theme", type: "text", value: "dark" },
    ]);
  });

  it("advertises the value of the group, whatever the widget stored", () => {
    const stored = { params: { symbol: "AAPL", theme: "dark" } };

    const result = createCopilotWidget(
      "asset-info",
      iframeWidget(),
      stored,
      undefined,
      [symbolGroup("MSFT")],
    );

    expect(currentValueOf(result, "symbol")).toBe("MSFT");
    expect(currentValueOf(result, "theme")).toBe("dark");
  });

  it("advertises what the widget stored when it is in no group", () => {
    const stored = { params: { symbol: "TSLA", theme: "dark" } };

    expect(
      currentValueOf(
        createCopilotWidget("asset-info", iframeWidget(), stored),
        "symbol",
      ),
    ).toBe("TSLA");
    expect(
      currentValueOf(
        createCopilotWidget("asset-info", iframeWidget(), stored, undefined, []),
        "symbol",
      ),
    ).toBe("TSLA");
  });

  it("advertises what the widget stored while the group has no value yet", () => {
    const stored = { params: { symbol: "TSLA" } };

    const result = createCopilotWidget(
      "asset-info",
      iframeWidget(),
      stored,
      undefined,
      [symbolGroup(null)],
    );

    expect(currentValueOf(result, "symbol")).toBe("TSLA");
  });

  it("does not let a group of another parameter change this one", () => {
    const stored = { params: { symbol: "TSLA", theme: "dark" } };
    const otherGroup = {
      ...symbolGroup("light"),
      id: "g-2",
      groupById: "theme",
    } as Group;

    const result = createCopilotWidget(
      "asset-info",
      iframeWidget(),
      stored,
      undefined,
      [otherGroup],
    );

    expect(currentValueOf(result, "symbol")).toBe("TSLA");
    expect(currentValueOf(result, "theme")).toBe("light");
  });

  it("keeps a value that the user typed and has not run, over the group's", () => {
    const result = createCopilotWidget(
      "asset-info",
      iframeWidget(),
      { params: { symbol: "AAPL" } },
      { copilotDraftParams: { symbol: "NVDA" } },
      [symbolGroup("MSFT")],
    );

    expect(currentValueOf(result, "symbol")).toBe("NVDA");
  });

  it("says what the widget is, so that an iframe widget can be told from the others", () => {
    expect(createCopilotWidget("asset-info", iframeWidget(), {})?.widget_type).toBe(
      "iframe",
    );
    const table = createWidget({
      id: "t",
      widgetId: "t",
      type: "table" as WidgetT["type"],
    });
    expect(createCopilotWidget("t", table, {})?.widget_type).toBe("table");
  });
});

describe("useGetCopilotWidgets - agent payload vs. advertised dashboard state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWidgetInfo.mockReturnValue({
      name: "Test Widget",
      description: "Test description",
      source: "test-source",
      category: "Test",
      subCategory: "Test",
    });
    mockGetSideBarItem.mockImplementation(() => ({
      data: {
        name: "Kalshi Prediction Markets",
        widgets: mockGetWidgetsInCurrentDashboard(),
        currentTab: mockGetLastInnerTab(),
        gridLayout: {},
      },
    }));
  });

  function setupDashboard(cachedData: Record<string, unknown>) {
    mockGetLastInnerTab.mockReturnValue("event");
    mockGetWidgetsInCurrentDashboard.mockReturnValue([
      createWidget({
        id: "nav-1",
        widgetId: "navigation_bar",
        storage: {
          tabs: [
            { id: "event", name: "Event" },
            { id: "market", name: "Market" },
          ],
        },
      }),
      createWidget({
        id: "w-metrics",
        name: "Selected Event Metrics",
        innerTab: "event",
      }),
      createWidget({ id: "w-price", name: "Event Price History", innerTab: "event" }),
      createWidget({ id: "w-tape", name: "Trade Tape", innerTab: "market" }),
    ]);
    mockGetDashboardWidgetsData.mockReturnValue(cachedData);
    renderHook(() => useGetCopilotWidgets());
    const call = mockSetCopilotWidgets.mock.calls[0]?.[0];
    return {
      sentToAgent: (call?.allDashboardWidgets ?? []).map(
        (w: { uuid: string }) => w.uuid,
      ),
      advertisedInPrompt: (
        call?.workspaceState?.current_dashboard_info?.tabs ?? []
      ).flatMap((t: { widgets: { widget_uuid: string }[] }) =>
        t.widgets.map((w) => w.widget_uuid),
      ),
    };
  }

  it("does not drop a current-tab widget just because its data has not cached yet", () => {
    const { sentToAgent } = setupDashboard({
      "w-metrics": { metadata: {}, title: "Selected Event Metrics", innerTab: "event" },
    });

    expect(sentToAgent).toContain("w-tape");
    expect(sentToAgent).toContain("w-price");
  });

  it("never advertises a widget uuid the agent cannot fetch", () => {
    const { sentToAgent, advertisedInPrompt } = setupDashboard({
      "w-metrics": { metadata: {}, title: "Selected Event Metrics", innerTab: "event" },
    });

    const unfetchable = advertisedInPrompt.filter(
      (uuid: string) => !sentToAgent.includes(uuid),
    );
    expect(unfetchable).toEqual([]);
  });

  it("sends every widget once the whole dashboard has cached data", () => {
    const { sentToAgent, advertisedInPrompt } = setupDashboard({
      "w-metrics": { metadata: {}, title: "Selected Event Metrics", innerTab: "event" },
      "w-price": { metadata: {}, title: "Event Price History", innerTab: "event" },
      "w-tape": { metadata: {}, title: "Trade Tape", innerTab: "market" },
    });

    expect(sentToAgent).toHaveLength(3);
    expect(advertisedInPrompt.every((u: string) => sentToAgent.includes(u))).toBe(true);
  });
});

describe("useGetCopilotWidgets - an iframe widget whose page has published entries", () => {
  const WIDGET_UUID = "0b6f6a0e-5c1d-4a52-9d1e-3b0c9f6a1e11";

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWidgetInfo.mockReturnValue({
      name: "TradingView Chart",
      description: "A chart",
      source: "ODP",
      category: "Test",
      subCategory: "Test",
    });
    mockGetLastInnerTab.mockReturnValue("");
    mockGetSideBarItem.mockImplementation(() => ({
      data: {
        name: "Dashboard",
        widgets: mockGetWidgetsInCurrentDashboard(),
        currentTab: "",
        gridLayout: {},
      },
    }));
    mockGetWidgetsInCurrentDashboard.mockReturnValue([
      createWidget({ id: WIDGET_UUID, name: "TradingView Chart", widgetId: "tv", type: "iframe" }),
    ]);
    mockGetDashboardWidgetsData.mockReturnValue({
      [WIDGET_UUID]: { metadata: {}, title: "TradingView Chart" },
    });
  });

  afterEach(() => unregisterIframeWidget(WIDGET_UUID));

  const sent = () => mockSetCopilotWidgets.mock.calls[0]?.[0];

  it("sends the widget itself, by its own uuid, once the page has published entries", () => {
    registerIframeWidget(WIDGET_UUID, {
      requestWidgetData: vi.fn(),
      sendRefresh: vi.fn(),
      manifest: [{ widgetId: "tvc_made_up_by_the_page", name: "Chart", dataType: "table" }],
    });

    renderHook(() => useGetCopilotWidgets());

    const toAgent = (sent()?.allDashboardWidgets ?? []) as { uuid: string; widget_type?: string }[];
    expect(toAgent.find((w) => w.uuid === WIDGET_UUID)).toMatchObject({
      uuid: WIDGET_UUID,
      widget_type: "iframe",
    });
    expect(toAgent.map((w) => w.uuid)).toContain(
      `${WIDGET_UUID}::iframe::tvc_made_up_by_the_page`,
    );
  });

  it("sends the same widget before the page has published anything", () => {
    renderHook(() => useGetCopilotWidgets());

    const toAgent = (sent()?.allDashboardWidgets ?? []) as { uuid: string; widget_type?: string }[];
    expect(toAgent.map((w) => w.uuid)).toEqual([WIDGET_UUID]);
    expect(toAgent[0].widget_type).toBe("iframe");
  });

  it("keeps the widget out of the current-tab slice, which holds what the page published", () => {
    registerIframeWidget(WIDGET_UUID, {
      requestWidgetData: vi.fn(),
      sendRefresh: vi.fn(),
      manifest: [{ widgetId: "tvc_made_up_by_the_page", name: "Chart", dataType: "table" }],
    });

    renderHook(() => useGetCopilotWidgets());

    const slice = ((sent()?.dashboardWidgets ?? []) as { uuid: string }[]).map((w) => w.uuid);
    expect(slice).toEqual([`${WIDGET_UUID}::iframe::tvc_made_up_by_the_page`]);
  });
});

describe("useGetCopilotWidgets - current-tab slice uses raw widget tab membership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWidgetInfo.mockReturnValue({
      name: "Test Widget",
      description: "Test description",
      source: "test-source",
      category: "Test",
      subCategory: "Test",
    });
    mockGetSideBarItem.mockImplementation(() => ({
      data: {
        name: "Kalshi Prediction Markets",
        widgets: mockGetWidgetsInCurrentDashboard(),
        currentTab: mockGetLastInnerTab(),
        gridLayout: {},
      },
    }));
  });

  it("keeps an unloaded off-tab widget out of the current-tab slice", () => {
    mockGetLastInnerTab.mockReturnValue("event");
    mockGetWidgetsInCurrentDashboard.mockReturnValue([
      createWidget({
        id: "nav-1",
        widgetId: "navigation_bar",
        storage: {
          tabs: [
            { id: "event", name: "Event" },
            { id: "market", name: "Market" },
          ],
        },
      }),
      createWidget({ id: "w-price", name: "Event Price History", innerTab: "event" }),
      createWidget({ id: "w-tape", name: "Trade Tape", innerTab: "market" }),
    ]);
    mockGetDashboardWidgetsData.mockReturnValue({});

    renderHook(() => useGetCopilotWidgets());
    const call = mockSetCopilotWidgets.mock.calls[0]?.[0];
    const currentTabSlice = (call?.dashboardWidgets ?? []).map(
      (w: { uuid: string }) => w.uuid,
    );
    const wholeDashboard = (call?.allDashboardWidgets ?? []).map(
      (w: { uuid: string }) => w.uuid,
    );

    expect(wholeDashboard).toContain("w-price");
    expect(wholeDashboard).toContain("w-tape");
    expect(currentTabSlice).toContain("w-price");
    expect(currentTabSlice).not.toContain("w-tape");
  });
});
