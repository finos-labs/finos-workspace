import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DraggableCard from "~/components/DraggableCard/DraggableCard";
import { useWidgetContext } from "~/components/Widget.context";
import { useStateReducer } from "~/hooks/useStateReducer";
import { useTabContext } from "~/lib/contexts/TabContext";
import { useBackendConnectorStore } from "~/lib/state/backendConnector";
import { partial } from "../../mocks";

vi.mock("~/components/Widget.context", () => ({
  useWidgetContext: vi.fn(),
}));

vi.mock("~/lib/contexts/TabContext", () => ({
  useTabContext: vi.fn(),
}));

vi.mock("~/hooks/useStateReducer", () => ({
  useStateReducer: vi.fn(() => [{ accessError: null, hasAccess: true }, vi.fn()]),
}));

vi.mock("~/lib/state/copilot", () => ({
  useShallowCopilotStore: vi.fn(() => ({
    onHoveredCitation: false,
    isTyping: false,
  })),
}));

vi.mock("~/lib/state/copilotData", () => ({
  useShallowCopilotDataStore: vi.fn(() => ({
    isSelected: false,
    selectedWidgetIDs: [],
  })),
}));

vi.mock("~/lib/state/permissions", () => ({
  useShallowPermissionsStore: vi.fn((selector: (state: unknown) => unknown) =>
    selector({
      hasAccess: () => true,
      permissions: { backends: [], files: [], prompts: [] },
    }),
  ),
}));

vi.mock("~/components/LayoutAuth/Search/hooks/useFetchSharedResources", () => ({
  default: vi.fn(),
}));

vi.mock("~/components/Widgets/Helpers/useCopilotDataWidget", () => ({
  default: vi.fn(),
}));

vi.mock("~/components/DraggableCard/NavBar", () => ({
  default: vi.fn(({ title }) => <div data-testid="navbar">{title}</div>),
}));

vi.mock("~/components/DraggableCard/SetLoadingOnResize", () => ({
  LoadingElement: vi.fn(({ children }) => <div>{children}</div>),
}));

describe("DraggableCard", () => {
  const mockUseWidgetContext = vi.mocked(useWidgetContext);
  const mockUseTabContext = vi.mocked(useTabContext);

  beforeEach(() => {
    mockUseTabContext.mockReturnValue(
      partial({
        isShared: false,
      }),
    );

    vi.mocked(useStateReducer).mockReturnValue([
      { accessError: null, hasAccess: true },
      vi.fn(),
    ]);
  });

  it("renders normally when widget ID is not blocked", () => {
    mockUseWidgetContext.mockReturnValue(
      partial({
        widgetRef: {
          current: {
            id: "widget-123",
            widgetId: "widget-123",
            name: "Test Widget",
          },
        },
        widgetFromJSON: null,
        widget: {
          sourceId: "source-1",
          widgetId: "widget-123",
          external: false,
          endpoint: { url: "https://example.com" },
          sourceName: "Test Source",
        },
      }),
    );

    render(
      <DraggableCard title="Test Widget">
        <div data-testid="widget-content">Widget Content</div>
      </DraggableCard>,
    );

    expect(screen.getByTestId("widget-content")).toBeInTheDocument();
    expect(screen.getByTestId("navbar")).toBeInTheDocument();
  });

  it("shows error message when widget is blocked", () => {
    mockUseWidgetContext.mockReturnValue(
      partial({
        widgetRef: {
          current: {
            id: "blocked-widget",
            widgetId: "blocked-widget",
            name: "Blocked Widget",
          },
        },
        widgetFromJSON: null,
        widget: {
          sourceId: "source-1",
          widgetId: "blocked-widget",
          external: false,
          endpoint: { url: "https://example.com" },
          sourceName: "Test Source",
        },
      }),
    );

    vi.mocked(useStateReducer).mockReturnValue([
      {
        accessError: "This widget is currently blocked from loading.",
        hasAccess: false,
      },
      vi.fn(),
    ]);

    render(
      <DraggableCard title="Blocked Widget" isBlocked={true}>
        <div data-testid="widget-content">Widget Content</div>
      </DraggableCard>,
    );

    expect(
      screen.getByText("This widget is currently blocked from loading."),
    ).toBeInTheDocument();
    expect(screen.getByText("Remove Widget")).toBeInTheDocument();
    expect(screen.queryByTestId("widget-content")).not.toBeInTheDocument();
  });

  it("renders normally when widget is not blocked", () => {
    mockUseWidgetContext.mockReturnValue(
      partial({
        widgetRef: {
          current: {
            id: "widget-123",
            widgetId: "widget-123",
            name: "Normal Widget",
          },
        },
        widgetFromJSON: null,
        widget: {
          sourceId: "source-1",
          widgetId: "widget-123",
          external: false,
          endpoint: { url: "https://example.com" },
          sourceName: "Test Source",
        },
      }),
    );

    render(
      <DraggableCard title="Normal Widget" isBlocked={false}>
        <div data-testid="widget-content">Widget Content</div>
      </DraggableCard>,
    );

    expect(screen.getByTestId("widget-content")).toBeInTheDocument();
    expect(
      screen.queryByText("This widget is currently blocked from loading."),
    ).not.toBeInTheDocument();
  });

  it("shows error message when widget is blocked even if it's a shared resource", () => {
    mockUseWidgetContext.mockReturnValue(
      partial({
        widgetRef: {
          current: {
            id: "blocked-shared-widget",
            widgetId: "blocked-shared-widget",
            name: "Blocked Shared Widget",
            isSharedWidget: true,
          },
        },
        widgetFromJSON: null,
        widget: {
          sourceId: "source-1",
          widgetId: "blocked-shared-widget",
          external: false,
          endpoint: { url: "https://example.com" },
          sourceName: "Test Source",
        },
      }),
    );

    vi.mocked(useStateReducer).mockReturnValue([
      {
        accessError: "This widget is deprecated and cannot be used.",
        hasAccess: false,
      },
      vi.fn(),
    ]);

    render(
      <DraggableCard title="Blocked Shared Widget" isBlocked={true}>
        <div data-testid="widget-content">Widget Content</div>
      </DraggableCard>,
    );

    expect(
      screen.getByText("This widget is deprecated and cannot be used."),
    ).toBeInTheDocument();
    expect(screen.getByText("Remove Widget")).toBeInTheDocument();
    expect(screen.queryByTestId("widget-content")).not.toBeInTheDocument();
  });

  it("shows error message when widget ID is in blocked list", () => {
    mockUseWidgetContext.mockReturnValue(
      partial({
        widgetRef: {
          current: {
            id: "price-target-analyst",
            widgetId: "price-target-analyst",
            name: "Price Target Analyst Widget",
          },
        },
        widgetFromJSON: null,
        widget: {
          sourceId: "source-1",
          widgetId: "price-target-analyst",
          external: false,
          endpoint: { url: "https://example.com" },
          sourceName: "Test Source",
        },
      }),
    );

    vi.mocked(useStateReducer).mockReturnValue([
      {
        accessError: "This widget is deprecated and cannot be used.",
        hasAccess: false,
      },
      vi.fn(),
    ]);

    render(
      <DraggableCard title="Price Target Analyst Widget">
        <div data-testid="widget-content">Widget Content</div>
      </DraggableCard>,
    );

    expect(
      screen.getByText("This widget is deprecated and cannot be used."),
    ).toBeInTheDocument();
    expect(screen.getByText("Remove Widget")).toBeInTheDocument();
    expect(screen.queryByTestId("widget-content")).not.toBeInTheDocument();
  });

  it("renders normally when widget ID is not in blocked list", () => {
    mockUseWidgetContext.mockReturnValue(
      partial({
        widgetRef: {
          current: {
            id: "widget-not-blocked",
            widgetId: "widget-not-blocked",
            name: "Normal Widget",
          },
        },
        widgetFromJSON: null,
        widget: {
          sourceId: "source-1",
          widgetId: "widget-not-blocked",
          external: false,
          endpoint: { url: "https://example.com" },
          sourceName: "Test Source",
        },
      }),
    );

    render(
      <DraggableCard title="Normal Widget">
        <div data-testid="widget-content">Widget Content</div>
      </DraggableCard>,
    );

    expect(screen.getByTestId("widget-content")).toBeInTheDocument();
    expect(
      screen.queryByText("This widget is deprecated and cannot be used."),
    ).not.toBeInTheDocument();
  });

  it("renders normally when external widget has blocked ID", () => {
    mockUseWidgetContext.mockReturnValue(
      partial({
        widgetRef: {
          current: {
            id: "yield_curve",
            widgetId: "yield_curve",
            name: "External Yield Curve Widget",
          },
        },
        widgetFromJSON: null,
        widget: {
          sourceId: "source-1",
          widgetId: "yield_curve",
          external: true,
          endpoint: { url: "https://external-api.com" },
          sourceName: "External Source",
        },
      }),
    );

    render(
      <DraggableCard title="External Yield Curve Widget">
        <div data-testid="widget-content">Widget Content</div>
      </DraggableCard>,
    );

    expect(
      screen.queryByText("This widget is deprecated and cannot be used."),
    ).not.toBeInTheDocument();

    expect(screen.queryByTestId("results-not-found")).not.toBeInTheDocument();

    expect(screen.getByTestId("navbar")).toBeInTheDocument();
  });

  describe("a widget whose data backend is not the viewer's", () => {
    const widgetFromSomeoneElse = () =>
      mockUseWidgetContext.mockReturnValue(
        partial({
          widgetRef: {
            current: {
              id: "widget-shared",
              widgetId: "prices",
              name: "Prices",
              sourceId: "owners-backend",
              connectionType: "advanced-backend",
            },
          },
          widgetFromJSON: null,
          widget: { sourceId: "owners-backend", widgetId: "prices" },
        }),
      );

    afterEach(() => {
      cleanup();
      useBackendConnectorStore.setState({ apiSources: [], sourcesLoaded: false });
    });

    it("says the data connection is not available instead of rendering the widget", () => {
      useBackendConnectorStore.setState({ apiSources: [], sourcesLoaded: true });
      widgetFromSomeoneElse();

      render(
        <DraggableCard title="Prices">
          <div data-testid="widget-content">Widget Content</div>
        </DraggableCard>,
      );

      expect(
        screen.getByText("This data connection is not available to you"),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("widget-content")).not.toBeInTheDocument();
    });

    it("renders the widget once the backend is among the viewer's own", () => {
      useBackendConnectorStore.setState({
        apiSources: [partial({ id: "owners-backend", name: "Mine", url: "https://x" })],
        sourcesLoaded: true,
      });
      widgetFromSomeoneElse();

      render(
        <DraggableCard title="Prices">
          <div data-testid="widget-content">Widget Content</div>
        </DraggableCard>,
      );

      expect(screen.getByTestId("widget-content")).toBeInTheDocument();
      expect(
        screen.queryByText("This data connection is not available to you"),
      ).not.toBeInTheDocument();
    });
  });
});
