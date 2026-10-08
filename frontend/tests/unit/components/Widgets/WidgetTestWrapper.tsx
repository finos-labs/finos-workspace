import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type React from "react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import type { WidgetContextType, WidgetT } from "~/components/types";
import { WidgetContext } from "~/components/Widget.context";
import { makeWidget, makeWidgetContext } from "../../factories";
import { type DeepPartial, partial } from "../../mocks";

export const createMockWidget = (overrides: DeepPartial<WidgetT> = {}): WidgetT =>
  partial<WidgetT>({
    ...makeWidget({ id: "test-uuid", widgetId: "test-widget-id" }),
    ...overrides,
  });

export const WidgetTestWrapper = ({
  children,
  widgetOverrides = {},
  activeDashboardId = "test-dashboard-id",
  isShared = false,
  updateWidget = vi.fn(),
}: {
  children: React.ReactNode;
  widgetOverrides?: DeepPartial<WidgetT>;
  activeDashboardId?: string;
  isShared?: boolean;
  updateWidget?: WidgetContextType["updateWidget"];
}) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  const widget = createMockWidget(widgetOverrides);
  const getWidget = vi.fn(() => widget);

  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <WidgetContext.Provider
          value={makeWidgetContext(widget, {
            widgetFromJSON: widget,
            activeDashboardId,
            isShared,
            uuid: widget.id,
            updateWidget,
            getWidget,
          })}
        >
          {children}
        </WidgetContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>
  );
};

export const renderWidget = (
  ui: React.ReactElement,
  options: {
    widgetOverrides?: DeepPartial<WidgetT>;
    activeDashboardId?: string;
    isShared?: boolean;
    updateWidget?: WidgetContextType["updateWidget"];
  } = {},
) => {
  return render(<WidgetTestWrapper {...options}>{ui}</WidgetTestWrapper>);
};
