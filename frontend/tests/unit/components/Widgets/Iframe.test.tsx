import { screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { useIframeProtocol as UseIframeProtocol } from "~/components/Widgets/Helpers/useIframeProtocol";
import Iframe from "~/components/Widgets/Iframe";
import type { PluginFrameStatus } from "~/hooks/usePluginManager";
import { IFRAME_SANDBOX_ATTRIBUTES } from "~/lib/constants";
import type { Group } from "~/lib/state/app";
import { useThemeStore } from "~/lib/state/theme";
import { makeEndpointParamGroup } from "../../factories";
import { partial } from "../../mocks";
import { renderWidget, WidgetTestWrapper } from "./WidgetTestWrapper";

type IframeProtocol = ReturnType<typeof UseIframeProtocol>;

const iframeProtocolMock = vi.hoisted(() => ({
  // Only what the Iframe widget reads of the protocol
  state: {
    manifest: [],
    paramDefs: null,
    requestWidgetData: vi.fn(),
    sendParamsUpdate: vi.fn(),
  } as unknown as IframeProtocol,
}));

const appStoreMock = vi.hoisted(() => ({
  getWidgetGroups: vi.fn<(tabId: string, widgetId: string | undefined) => Group[]>(
    () => [],
  ),
  updateGroup: vi.fn(),
}));

const sharedAppStoreMock = vi.hoisted(() => ({
  getWidgetGroups: vi.fn<(tabId: string, widgetId: string | undefined) => Group[]>(
    () => [],
  ),
}));

const pluginFrameMock = vi.hoisted(() => ({
  status: { state: "not-plugin" } as PluginFrameStatus,
}));

vi.mock("~/hooks/usePluginManager", () => ({
  usePluginFrameStatus: () => pluginFrameMock.status,
}));

const queryParamsMock = vi.hoisted(() => ({
  renderRow0Params: null as ReactNode,
  renderBelowNavbarRows: null as ReactNode,
}));

vi.mock("~/components/DraggableCard", () => ({
  default: ({
    children,
    elementRightNextToTitle,
    elementNextToTitle,
    elementBelowNavbar,
    extraNavbarElements,
  }: {
    children?: ReactNode;
    elementRightNextToTitle?: ReactNode;
    elementNextToTitle?: ReactNode;
    elementBelowNavbar?: ReactNode;
    extraNavbarElements?: ReactNode;
  }) => (
    <div data-testid="draggable-card">
      {elementRightNextToTitle}
      {elementNextToTitle}
      {elementBelowNavbar}
      {extraNavbarElements}
      {children}
    </div>
  ),
}));

vi.mock("~/components/General/SearchResultsNotFound", () => ({
  default: ({
    firstMessage,
    children,
  }: {
    firstMessage?: ReactNode;
    children?: ReactNode;
  }) => (
    <div data-testid="search-not-found">
      <span>{firstMessage}</span>
      {children}
    </div>
  ),
}));

vi.mock("~/components/ds/dialogs/BaseDialog", () => ({
  BaseDialog: ({ children, open }: { children?: ReactNode; open?: boolean }) =>
    open ? <div data-testid="url-dialog">{children}</div> : null,
}));

vi.mock("~/lib/providers/MobileProvider", () => ({
  useMobile: () => ({
    isMobile: false,
    setMobileCopilotDrawer: vi.fn(),
  }),
}));

vi.mock("~/lib/state/app", () => ({
  useShallowAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      items: {},
      getWidgetGroups: vi.fn((tabId: string, widgetId: string | undefined) => {
        if (tabId === "shared-tab") {
          return sharedAppStoreMock.getWidgetGroups(tabId, widgetId);
        }
        return appStoreMock.getWidgetGroups(tabId, widgetId);
      }),
      updateGroup: appStoreMock.updateGroup,
    }),
}));

vi.mock("~/lib/state/sharedApp", () => ({
  useShallowSharedAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      getWidgetGroups: sharedAppStoreMock.getWidgetGroups,
    }),
}));

vi.mock("~/components/Widgets/Helpers/IframeParamControls", () => ({
  IframeParamControls: ({ paramDefs }: { paramDefs: { paramName: string }[] }) => (
    <div data-testid="iframe-param-controls">
      {paramDefs.map((param) => (
        <span key={param.paramName}>{param.paramName}</span>
      ))}
    </div>
  ),
}));

vi.mock("~/components/Widgets/Helpers/useIframeProtocol", () => ({
  useIframeProtocol: () => iframeProtocolMock.state,
}));

vi.mock("~/components/WidgetParams/QueryParams", () => ({
  useWidgetParamsPositions: () => queryParamsMock,
}));

describe("Iframe Widget", () => {
  beforeEach(() => {
    useThemeStore.setState({ theme: "dark" });
    iframeProtocolMock.state.manifest = [];
    iframeProtocolMock.state.paramDefs = null;
    iframeProtocolMock.state.requestWidgetData = vi.fn();
    iframeProtocolMock.state.sendParamsUpdate = vi.fn();
    appStoreMock.getWidgetGroups.mockReturnValue([]);
    appStoreMock.updateGroup.mockReset();
    sharedAppStoreMock.getWidgetGroups.mockReturnValue([]);
    queryParamsMock.renderRow0Params = null;
    queryParamsMock.renderBelowNavbarRows = null;
    pluginFrameMock.status = { state: "not-plugin" };
  });

  describe("plugin pages", () => {
    const pluginUrl = "http://localhost:5173/plugins/advanced-grouping";

    it("hides a plugin page while its plugin is disabled", () => {
      pluginFrameMock.status = {
        state: "unavailable",
        message: "BQ Advanced Grouping is disabled.",
      };
      renderWidget(<Iframe />, { widgetOverrides: { storage: { html: pluginUrl } } });

      expect(screen.getByText("Plugin unavailable")).toBeInTheDocument();
      expect(document.querySelector("iframe")).toBeNull();
    });

    it("shows the approved version of an enabled plugin, with scripts allowed", () => {
      pluginFrameMock.status = {
        state: "available",
        src: `${pluginUrl}/1.0.0/?theme=dark`,
      };
      renderWidget(<Iframe />, { widgetOverrides: { storage: { html: pluginUrl } } });

      const iframe = document.querySelector("iframe");
      expect(iframe?.getAttribute("src")).toBe(`${pluginUrl}/1.0.0/?theme=dark`);
      expect(iframe?.getAttribute("sandbox")).toContain("allow-scripts");
    });

    it("waits for the plugin check before loading the page", () => {
      pluginFrameMock.status = { state: "checking" };
      renderWidget(<Iframe />, { widgetOverrides: { storage: { html: pluginUrl } } });

      expect(document.querySelector("iframe")).toBeNull();
    });

    it("loads other pages as entered, with the standard iframe sandbox", () => {
      renderWidget(<Iframe />, {
        widgetOverrides: { storage: { html: "https://example.com" } },
      });

      const iframe = document.querySelector("iframe");
      expect(iframe).toHaveAttribute("src", "https://example.com/?theme=dark");
      expect(iframe).toHaveAttribute("sandbox", IFRAME_SANDBOX_ATTRIBUTES);
    });
  });

  it("renders empty state when no URL is provided", () => {
    renderWidget(<Iframe />, {
      widgetOverrides: { storage: { html: "" } },
    });

    expect(screen.getByTestId("search-not-found")).toBeInTheDocument();
    expect(screen.getByText("No URL provided")).toBeInTheDocument();
  });

  it("renders Add URL button in empty state", () => {
    renderWidget(<Iframe />, {
      widgetOverrides: { storage: { html: "" } },
    });

    expect(screen.getByRole("button", { name: /add url/i })).toBeInTheDocument();
  });

  it("renders iframe when URL is provided", () => {
    renderWidget(<Iframe />, {
      widgetOverrides: {
        storage: { html: "https://example.com", scale: 1.0 },
      },
    });

    const iframe = document.querySelector("iframe");
    expect(iframe).toBeInTheDocument();
    expect(iframe).toHaveAttribute("src", "https://example.com/?theme=dark");
  });

  it("passes the active light theme to iframe URLs", () => {
    useThemeStore.setState({ theme: "light" });

    renderWidget(<Iframe />, {
      widgetOverrides: {
        storage: { html: "https://example.com/widget", scale: 1.0 },
      },
    });

    const iframe = document.querySelector("iframe");
    expect(iframe).toHaveAttribute("src", "https://example.com/widget?theme=light");
  });

  it("displays URL in button when URL is set", () => {
    renderWidget(<Iframe />, {
      widgetOverrides: {
        storage: { html: "https://site.test", scale: 1.0 },
      },
    });

    expect(screen.getByText("https://site.test")).toBeInTheDocument();
  });

  it("shows zoom controls when URL is provided", () => {
    renderWidget(<Iframe />, {
      widgetOverrides: {
        storage: { html: "https://example.com", scale: 1.0 },
      },
    });

    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("hides iframe protocol params that are hidden by the widget manifest", () => {
    iframeProtocolMock.state.manifest = [
      { widgetId: "browse_markets", name: "Browse Markets", dataType: "markdown" },
    ];
    iframeProtocolMock.state.paramDefs = [
      {
        paramName: "event_ticker",
        label: "Select event shared with the dashboard",
        type: "text",
        value: "KXEVENT",
      },
      {
        paramName: "search",
        label: "Search",
        type: "text",
        value: "",
      },
    ];

    renderWidget(<Iframe />, {
      widgetOverrides: {
        id: "browse_markets",
        storage: { html: "https://example.com", scale: 1.0 },
        params: [
          {
            paramName: "event_ticker",
            type: "endpoint",
            show: false,
          },
        ],
      },
    });

    expect(screen.getByTestId("iframe-param-controls")).toHaveTextContent("search");
    expect(screen.queryByText("event_ticker")).not.toBeInTheDocument();
  });

  it("renders visible widget params through the shared navbar controls", () => {
    queryParamsMock.renderRow0Params = (
      <div data-testid="native-widget-params">Category / Tag / Event</div>
    );

    renderWidget(<Iframe />, {
      widgetOverrides: {
        id: "browse_markets",
        storage: { html: "https://example.com", scale: 1.0 },
        params: [
          {
            paramName: "selection",
            type: "endpoint",
            show: true,
          },
        ],
      },
    });

    expect(screen.getByTestId("native-widget-params")).toHaveTextContent(
      "Category / Tag / Event",
    );
  });

  it("does not duplicate iframe protocol params already owned by widget params", () => {
    iframeProtocolMock.state.manifest = [
      { widgetId: "browse_markets", name: "Browse Markets", dataType: "markdown" },
    ];
    iframeProtocolMock.state.paramDefs = [
      {
        paramName: "selection",
        label: "Category / Tag / Event",
        type: "text",
        value: "All",
      },
      {
        paramName: "search",
        label: "Search",
        type: "text",
        value: "",
      },
    ];

    renderWidget(<Iframe />, {
      widgetOverrides: {
        id: "browse_markets",
        storage: { html: "https://example.com", scale: 1.0 },
        params: [
          {
            paramName: "selection",
            type: "endpoint",
            show: true,
          },
        ],
      },
    });

    expect(screen.getByTestId("iframe-param-controls")).toHaveTextContent("search");
    expect(screen.getByTestId("iframe-param-controls")).not.toHaveTextContent(
      "selection",
    );
  });

  it("uses grouped params in the iframe URL even when widget storage is stale", () => {
    appStoreMock.getWidgetGroups.mockReturnValue([
      makeEndpointParamGroup({
        id: "selection-group",
        groupById: "selection-options",
        value: "Sports",
      }),
    ]);

    renderWidget(<Iframe />, {
      widgetOverrides: {
        id: "browse_markets",
        storage: {
          html: "https://example.com/browse",
          scale: 1.0,
          params: { selection: "All" },
        },
        params: [
          {
            paramName: "selection",
            type: "endpoint",
            groupById: "selection-options",
            value: "All",
            show: true,
          },
        ],
      },
    });

    const iframe = document.querySelector("iframe");
    expect(iframe).toHaveAttribute(
      "src",
      "https://example.com/browse?selection=Sports&theme=dark",
    );
  });

  it("uses grouped params in the iframe URL when widget params are row-grouped", () => {
    appStoreMock.getWidgetGroups.mockReturnValue([
      makeEndpointParamGroup({
        id: "selection-group",
        groupById: "selection-options",
        value: "Sports",
      }),
    ]);

    renderWidget(<Iframe />, {
      widgetOverrides: {
        id: "browse_markets",
        storage: {
          html: "https://example.com/browse",
          scale: 1.0,
          params: { selection: "All" },
        },
        params: partial([
          {
            paramName: "selection",
            type: "endpoint",
            groupById: "selection-options",
            value: "All",
            show: true,
          },
        ]),
      },
    });

    const iframe = document.querySelector("iframe");
    expect(iframe).toHaveAttribute(
      "src",
      "https://example.com/browse?selection=Sports&theme=dark",
    );
  });

  it("uses shared grouped params in the iframe URL", () => {
    sharedAppStoreMock.getWidgetGroups.mockReturnValue([
      makeEndpointParamGroup({
        id: "selection-group",
        groupById: "selection-options",
        value: "Crypto",
      }),
    ]);

    renderWidget(<Iframe />, {
      isShared: true,
      activeDashboardId: "shared-tab",
      widgetOverrides: {
        id: "browse_markets",
        storage: {
          html: "https://example.com/browse",
          scale: 1.0,
          params: { selection: "All" },
        },
        params: [
          {
            paramName: "selection",
            type: "endpoint",
            groupById: "selection-options",
            value: "All",
            show: true,
          },
        ],
      },
    });

    const iframe = document.querySelector("iframe");
    expect(iframe).toHaveAttribute(
      "src",
      "https://example.com/browse?selection=Crypto&theme=dark",
    );
  });

  describe("when a parameter changes", () => {
    const widgetOverrides = (refreshQuery?: number) => ({
      id: "browse_markets",
      ...(refreshQuery === undefined ? {} : { refreshQuery }),
      storage: {
        html: "https://example.com/browse",
        scale: 1.0,
        params: { selection: "All" },
      },
      params: [
        {
          paramName: "selection",
          type: "endpoint" as const,
          groupById: "selection-options",
          value: "All",
          show: true,
        },
      ],
    });
    const selectionIs = (value: string) =>
      appStoreMock.getWidgetGroups.mockReturnValue([
        makeEndpointParamGroup({
          id: "selection-group",
          groupById: "selection-options",
          value,
        }),
      ]);
    const page = (refreshQuery?: number) => (
      <WidgetTestWrapper widgetOverrides={widgetOverrides(refreshQuery)}>
        <Iframe />
      </WidgetTestWrapper>
    );
    const connected = () => {
      iframeProtocolMock.state.manifest = [
        { widgetId: "page-widget", name: "Page", dataType: "table" },
      ] as IframeProtocol["manifest"];
    };

    it("loads a page that has not connected over the protocol with the new address", () => {
      selectionIs("Sports");
      const view = renderWidget(<Iframe />, { widgetOverrides: widgetOverrides() });
      expect(document.querySelector("iframe")).toHaveAttribute(
        "src",
        "https://example.com/browse?selection=Sports&theme=dark",
      );

      selectionIs("Politics");
      view.rerender(page());

      expect(document.querySelector("iframe")).toHaveAttribute(
        "src",
        "https://example.com/browse?selection=Politics&theme=dark",
      );
    });

    it("does not reload a page that speaks the protocol: it is told with a message", () => {
      connected();
      selectionIs("Sports");
      const view = renderWidget(<Iframe />, { widgetOverrides: widgetOverrides() });
      const sent = vi.mocked(iframeProtocolMock.state.sendParamsUpdate);
      sent.mockClear();

      selectionIs("Politics");
      view.rerender(page());

      expect(document.querySelector("iframe")).toHaveAttribute(
        "src",
        "https://example.com/browse?selection=Sports&theme=dark",
      );
      expect(sent).toHaveBeenLastCalledWith(
        expect.objectContaining({ selection: "Politics" }),
      );
    });

    it("keeps the same iframe element, so nothing starts over", () => {
      connected();
      selectionIs("Sports");
      const view = renderWidget(<Iframe />, { widgetOverrides: widgetOverrides() });
      const before = document.querySelector("iframe");

      selectionIs("Politics");
      view.rerender(page());

      expect(document.querySelector("iframe")).toBe(before);
    });

    it("loads the current params when the user refreshes the widget", () => {
      connected();
      selectionIs("Sports");
      const view = renderWidget(<Iframe />, { widgetOverrides: widgetOverrides(1) });

      selectionIs("Politics");
      view.rerender(page(1));
      expect(document.querySelector("iframe")).toHaveAttribute(
        "src",
        "https://example.com/browse?selection=Sports&theme=dark",
      );

      view.rerender(page(2));
      expect(document.querySelector("iframe")).toHaveAttribute(
        "src",
        "https://example.com/browse?selection=Politics&theme=dark",
      );
    });
  });
});
