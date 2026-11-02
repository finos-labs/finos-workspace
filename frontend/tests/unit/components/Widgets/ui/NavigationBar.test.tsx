import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NavigationBar from "~/components/Widgets/ui/NavigationBar";

const dashboard = vi.hoisted(() => ({ locked: false, shared: false }));

vi.mock("react-router-dom", () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));

vi.mock("~/components/AI/contexts/TabHighlightContext", () => ({
  useTabHighlight: () => ({ hoveredWidgetTabId: null }),
}));

vi.mock("~/components/Widget.context", () => ({
  useWidgetContext: () => ({
    widget: { storage: { tabs: [{ id: "overview", name: "Overview" }] } },
    widgetRef: { current: { id: "navigation-bar-1", name: "Navigation Bar" } },
    activeDashboardId: "dash-1",
    updateWidget: vi.fn(),
    isShared: dashboard.shared,
  }),
}));

vi.mock("~/lib/state/app", () => ({
  useIsDashboardLocked: () => dashboard.locked,
  useShallowAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      getLastInnerTab: () => "overview",
      getTabById: () => undefined,
      removeWidget: vi.fn(),
      addWidget: vi.fn(),
      updateInnerTabs: vi.fn(),
    }),
}));

vi.mock("~/lib/state/theme", () => ({
  useShallowThemeStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ showWidgetControlsEllipsis: false }),
}));

vi.mock("~/components/Tooltip", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("~/components/Icon", () => ({ default: () => <span /> }));

describe("NavigationBar", () => {
  beforeEach(() => {
    dashboard.locked = false;
    dashboard.shared = false;
  });

  const editAndRemove = () => screen.getAllByRole("button").slice(-2);

  it("lets the tabs be edited and the bar be removed", () => {
    render(<NavigationBar />);

    for (const button of editAndRemove()) expect(button).toBeEnabled();
  });

  it("keeps the tabs of a locked dashboard as they are", () => {
    dashboard.locked = true;

    render(<NavigationBar />);

    for (const button of editAndRemove()) expect(button).toBeDisabled();
    expect(screen.getByRole("button", { name: "Overview" })).toBeEnabled();
  });

  it("keeps the tabs of a shared dashboard as they are", () => {
    dashboard.shared = true;

    render(<NavigationBar />);

    for (const button of editAndRemove()) expect(button).toBeDisabled();
  });
});
