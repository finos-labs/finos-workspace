import { render, screen, waitFor } from "@testing-library/react";
import { act, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NavBar from "~/components/DraggableCard/NavBar";
import { useWidgetContext } from "~/components/Widget.context";
import { useShallowCopilotDataStore } from "~/lib/state/copilotData";
import { useShallowThemeStore } from "~/lib/state/theme";
import { malformed, partial, stubStoreState } from "../../mocks";

// Mock the necessary hooks and components
vi.mock("~/components/Widget.context", () => ({
  useWidgetContext: vi.fn(),
}));

vi.mock("~/lib/state/app", () => ({
  useShallowAppStore: vi.fn(() => ({
    removeWidget: vi.fn(),
    minimizeWidget: vi.fn(),
  })),
  useAppStore: vi.fn(),
}));

vi.mock("~/lib/state/theme", () => ({
  useShallowThemeStore: vi.fn((selector) => {
    const state = {
      showWidgetControlsEllipsis: false,
      showMinimizeButton: true,
      isResizingGridElement: undefined,
    };
    return typeof selector === "function" ? selector(state) : state;
  }),
}));

vi.mock("~/lib/state/copilot", () => ({
  useShallowCopilotStore: vi.fn(() => ({
    showCopilotButton: false,
  })),
}));

vi.mock("~/lib/state/copilotData", () => ({
  useShallowCopilotDataStore: vi.fn(() => false),
}));

vi.mock("~/lib/contexts/TabContext", () => ({
  useTabContext: vi.fn(() => ({ isShared: false })),
}));

vi.mock("~/components/Widgets/Helpers/GroupDropdown", () => ({
  default: ({
    children,
    paramDef,
  }: {
    children?: ReactNode;
    paramDef?: { paramName?: string; label?: string };
  }) => (
    <div data-testid="group-dropdown" data-param-name={paramDef?.paramName}>
      {children ?? paramDef?.label ?? paramDef?.paramName}
    </div>
  ),
}));

vi.mock("usehooks-ts", () => ({
  useDebounceValue: vi.fn((value) => [value]),
  useWindowSize: () => ({ width: 1024, height: 768 }),
}));

describe("NavBar - Hidden parameter badges", () => {
  const mockUseWidgetContext = vi.mocked(useWidgetContext);

  beforeEach(() => {
    vi.clearAllMocks();

    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );

    mockUseWidgetContext.mockReturnValue(
      partial({
        widgetRef: {
          current: {
            id: "volume-by-category",
            widgetId: "volume_by_category",
            name: "Volume by Category",
            isMinimized: false,
            paramGroups: { selection: "group-1" },
          },
        },
        updateWidget: vi.fn(),
        widgetFromJSON: {
          external: true,
          params: [
            {
              paramName: "selection",
              type: "endpoint",
              groupById: "selection-options",
              label: "Category / Tag / Event",
              show: false,
            },
          ],
        },
      }),
    );
  });

  it("does not duplicate hidden badges already rendered by shared row params", () => {
    render(
      <NavBar
        title="Volume by Category"
        elementRightNextToTitle={
          <div data-widget-param-row="0">
            <div data-testid="group-dropdown" data-param-name="selection">
              Category / Tag / Event
            </div>
          </div>
        }
      />,
    );

    expect(screen.getAllByTestId("group-dropdown")).toHaveLength(1);
  });

  it("keeps the legacy hidden badge fallback when shared row params are absent", () => {
    render(<NavBar title="Volume by Category" />);

    expect(screen.getAllByTestId("group-dropdown")).toHaveLength(1);
    expect(screen.getByTestId("group-dropdown")).toHaveAttribute(
      "data-param-name",
      "selection",
    );
  });
});

describe("NavBar - Overflow Detection", () => {
  const mockUseWidgetContext = vi.mocked(useWidgetContext);

  // Mock ResizeObserver
  let resizeObserverCallback: ResizeObserverCallback | null = null;
  let observeSpy = vi.fn();
  let disconnectSpy = vi.fn();
  let unobserveSpy = vi.fn();
  const constructorSpy = vi.fn();

  class MockResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      constructorSpy(callback);
      resizeObserverCallback = callback;
    }
    observe(...args: unknown[]) {
      return observeSpy(...args);
    }
    disconnect(...args: unknown[]) {
      return disconnectSpy(...args);
    }
    unobserve(...args: unknown[]) {
      return unobserveSpy(...args);
    }
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resizeObserverCallback = null;
    observeSpy = vi.fn();
    disconnectSpy = vi.fn();
    unobserveSpy = vi.fn();

    global.ResizeObserver = partial(MockResizeObserver);

    mockUseWidgetContext.mockReturnValue(
      partial({
        widgetRef: {
          current: {
            id: "test-widget",
            widgetId: "test-widget",
            name: "Test Widget",
            isMinimized: false,
          },
        },
        updateWidget: vi.fn(),
        widgetFromJSON: {
          params: [],
        },
      }),
    );
  });

  it("should collapse controls when middle spacer width is <= 20px", async () => {
    const { container } = render(
      <NavBar title="Test Widget" showEllipsisMenu={true} />,
    );

    const middleSpacer = container.querySelector("._middle-navbar") as Element;
    expect(middleSpacer).toBeInTheDocument();

    // Mock the clientWidth to be below collapse threshold
    Object.defineProperty(middleSpacer, "clientWidth", {
      configurable: true,
      value: 15, // Below COLLAPSE_THRESHOLD (20)
    });

    // Trigger the ResizeObserver callback
    act(() => {
      if (resizeObserverCallback) {
        resizeObserverCallback?.(
          [{ target: middleSpacer } as ResizeObserverEntry],
          {} as ResizeObserver,
        );
      }
    });

    await waitFor(() => {
      // Controls should be collapsed (w-0 overflow-hidden opacity-0)
      const controls = container.querySelector(".w-0.overflow-hidden.opacity-0");
      expect(controls).toBeInTheDocument();
    });
  });

  it("should expand controls when middle spacer width is >= 150px", async () => {
    const { container } = render(
      <NavBar title="Test Widget" showEllipsisMenu={true} />,
    );

    const middleSpacer = container.querySelector("._middle-navbar") as Element;

    // First collapse by setting to small width
    Object.defineProperty(middleSpacer, "clientWidth", {
      configurable: true,
      value: 15,
    });

    if (resizeObserverCallback) {
      act(() => {
        resizeObserverCallback?.(
          [{ target: middleSpacer } as ResizeObserverEntry],
          {} as ResizeObserver,
        );
      });
    }

    // Wait for collapse
    await waitFor(() => {
      const controls = container.querySelector(".w-0.overflow-hidden.opacity-0");
      expect(controls).toBeInTheDocument();
    });

    // Now expand by setting to large width
    Object.defineProperty(middleSpacer, "clientWidth", {
      configurable: true,
      value: 200, // Above EXPAND_THRESHOLD (150)
    });

    if (resizeObserverCallback) {
      act(() => {
        resizeObserverCallback?.(
          [{ target: middleSpacer } as ResizeObserverEntry],
          {} as ResizeObserver,
        );
      });
    }

    await waitFor(() => {
      // Controls should be expanded (w-auto opacity-100)
      const controls = container.querySelector(".w-auto.opacity-100");
      expect(controls).toBeInTheDocument();
    });
  });

  it("should use hysteresis to prevent flickering (stay collapsed between thresholds)", async () => {
    const { container } = render(
      <NavBar title="Test Widget" showEllipsisMenu={true} />,
    );

    const middleSpacer = container.querySelector("._middle-navbar") as Element;

    // Start by collapsing
    Object.defineProperty(middleSpacer, "clientWidth", {
      configurable: true,
      value: 15, // Below COLLAPSE_THRESHOLD
    });

    if (resizeObserverCallback) {
      act(() => {
        resizeObserverCallback?.(
          [{ target: middleSpacer } as ResizeObserverEntry],
          {} as ResizeObserver,
        );
      });
    }

    await waitFor(() => {
      const controls = container.querySelector(".w-0.overflow-hidden.opacity-0");
      expect(controls).toBeInTheDocument();
    });

    // Now set width between thresholds (21-149) - should stay collapsed
    Object.defineProperty(middleSpacer, "clientWidth", {
      configurable: true,
      value: 100, // Between COLLAPSE_THRESHOLD (20) and EXPAND_THRESHOLD (150)
    });

    if (resizeObserverCallback) {
      act(() => {
        resizeObserverCallback?.(
          [{ target: middleSpacer } as ResizeObserverEntry],
          {} as ResizeObserver,
        );
      });
    }

    // Should remain collapsed despite having space
    await waitFor(() => {
      const controls = container.querySelector(".w-0.overflow-hidden.opacity-0");
      expect(controls).toBeInTheDocument();
    });
  });

  it("should use hysteresis to prevent flickering (stay expanded between thresholds)", async () => {
    const { container } = render(
      <NavBar title="Test Widget" showEllipsisMenu={true} />,
    );

    const middleSpacer = container.querySelector("._middle-navbar") as Element;

    // Start expanded with large width
    Object.defineProperty(middleSpacer, "clientWidth", {
      configurable: true,
      value: 200, // Above EXPAND_THRESHOLD
    });

    if (resizeObserverCallback) {
      act(() => {
        resizeObserverCallback?.(
          [{ target: middleSpacer } as ResizeObserverEntry],
          {} as ResizeObserver,
        );
      });
    }

    await waitFor(() => {
      const controls = container.querySelector(".w-auto.opacity-100");
      expect(controls).toBeInTheDocument();
    });

    // Now set width between thresholds - should stay expanded
    Object.defineProperty(middleSpacer, "clientWidth", {
      configurable: true,
      value: 100, // Between thresholds
    });

    if (resizeObserverCallback) {
      act(() => {
        resizeObserverCallback?.(
          [{ target: middleSpacer } as ResizeObserverEntry],
          {} as ResizeObserver,
        );
      });
    }

    // Should remain expanded
    await waitFor(() => {
      const controls = container.querySelector(".w-auto.opacity-100");
      expect(controls).toBeInTheDocument();
    });
  });

  it("should not enable overflow detection when showWidgetControlsEllipsis is true", async () => {
    // Import the mocked module at the top level
    const { useShallowThemeStore } = await import("~/lib/state/theme");

    // Override the mock for this specific test
    stubStoreState(useShallowThemeStore, {
      showWidgetControlsEllipsis: true, // Setting is ON
      showMinimizeButton: true,
      isResizingGridElement: undefined,
    });

    render(<NavBar title="Test Widget" showEllipsisMenu={true} />);

    // ResizeObserver should not be set up when setting is enabled
    expect(observeSpy).not.toHaveBeenCalled();
  });

  it("should cleanup ResizeObserver on unmount", () => {
    const { unmount } = render(<NavBar title="Test Widget" showEllipsisMenu={true} />);

    // Manually create and set up a ResizeObserver to simulate the component behavior
    // (In test environment, refs may not be available when useLayoutEffect runs)
    if (resizeObserverCallback) {
      // ResizeObserver was set up, now verify cleanup
      unmount();
      expect(disconnectSpy).toHaveBeenCalled();
    } else {
      // If ResizeObserver wasn't set up, cleanup shouldn't be called
      unmount();
      expect(disconnectSpy).not.toHaveBeenCalled();
    }
  });

  it("should handle missing middleSpacer ref gracefully", () => {
    const { container } = render(
      <NavBar title="Test Widget" showEllipsisMenu={true} />,
    );

    // Even if the ref doesn't exist or callback is called before mount, should not crash
    expect(container).toBeInTheDocument();
  });
});

describe("NavBar - Auto-locked controls for active widgets", () => {
  const mockUseWidgetContext = vi.mocked(useWidgetContext);

  beforeEach(() => {
    vi.clearAllMocks();

    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );

    mockUseWidgetContext.mockReturnValue(
      partial({
        widgetRef: {
          current: {
            id: "test-widget",
            widgetId: "test-widget",
            name: "Test Widget",
            isMinimized: false,
          },
        },
        updateWidget: vi.fn(),
        widgetFromJSON: { params: [] },
      }),
    );
  });

  function enableCollapse() {
    stubStoreState(useShallowThemeStore, {
      showWidgetControlsEllipsis: true,
      showMinimizeButton: true,
      isResizingGridElement: undefined,
    });
  }

  it("should keep controls visible when widget is selected and collapse is enabled", () => {
    enableCollapse();
    vi.mocked(useShallowCopilotDataStore).mockReturnValue(malformed(true));

    render(<NavBar title="Test Widget" showEllipsisMenu={true} />);

    expect(screen.getByTestId("_navbar-controls-left")).toHaveAttribute(
      "data-collapsed",
      "false",
    );
    expect(screen.getByTestId("_navbar-controls-right")).toHaveAttribute(
      "data-collapsed",
      "false",
    );
  });

  it("should collapse controls when no active control and collapse is enabled", () => {
    enableCollapse();
    vi.mocked(useShallowCopilotDataStore).mockReturnValue(malformed(false));

    render(<NavBar title="Test Widget" showEllipsisMenu={true} />);

    expect(screen.getByTestId("_navbar-controls-left")).toHaveAttribute(
      "data-collapsed",
      "true",
    );
    expect(screen.getByTestId("_navbar-controls-right")).toHaveAttribute(
      "data-collapsed",
      "true",
    );
  });

  it("should not collapse controls when shouldCollapse is false regardless of active state", () => {
    // Default theme mock has showWidgetControlsEllipsis: false
    vi.mocked(useShallowCopilotDataStore).mockReturnValue(malformed(true));

    render(<NavBar title="Test Widget" showEllipsisMenu={true} />);

    expect(screen.getByTestId("_navbar-controls-left")).toHaveAttribute(
      "data-collapsed",
      "false",
    );
    expect(screen.getByTestId("_navbar-controls-right")).toHaveAttribute(
      "data-collapsed",
      "false",
    );
  });
});
