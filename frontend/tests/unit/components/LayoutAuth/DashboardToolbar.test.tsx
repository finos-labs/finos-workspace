import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DashboardToolbar from "~/components/LayoutAuth/DashboardToolbar";

const dashboard = vi.hoisted(() => ({ locked: false, shared: false }));

vi.mock("react-router-dom", () => ({
  useParams: () => ({ id: "dash-1" }),
  useNavigate: () => vi.fn(),
}));

vi.mock("~/lib/state/app", () => ({
  DASHBOARD_LOCKED_MESSAGE: "Locked.",
  useIsDashboardLocked: () => dashboard.locked,
  useShallowAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      getAllTabActiveGroups: () => [],
      deleteGroup: vi.fn(),
      getWidgetsFromGroup: vi.fn(),
    }),
}));

vi.mock("~/lib/state/sharedApp", () => ({
  useShallowSharedAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ sharedItems: dashboard.shared ? { "dash-1": { data: {} } } : {} }),
  useSharedAppStore: { getState: () => ({ getDashboardById: vi.fn() }) },
}));

vi.mock("~/lib/state/theme", () => ({
  useShallowThemeStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      groupingVisible: false,
      setGroupingVisible: vi.fn(),
      toggleSearch: vi.fn(),
      setInitialSelectedSearchTab: vi.fn(),
      quickAddButtonVisible: true,
    }),
}));

vi.mock("~/lib/utils/shared", () => ({ duplicateDashboard: vi.fn() }));

vi.mock("~/components/Widgets/Helpers/GroupRow", () => ({
  GroupPanelHeader: () => null,
  GroupRow: () => null,
}));

vi.mock("~/components/Tooltip", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("~/components/Icon", () => ({ default: () => <span /> }));

describe("DashboardToolbar", () => {
  beforeEach(() => {
    dashboard.locked = false;
    dashboard.shared = false;
  });

  it("lets widgets be added to an unlocked dashboard", () => {
    render(<DashboardToolbar />);

    expect(screen.getByTestId("dashboard-toolbar-add-widget-button")).toBeEnabled();
  });

  it("does not let widgets be added to a locked dashboard", () => {
    dashboard.locked = true;

    render(<DashboardToolbar />);

    expect(screen.getByTestId("dashboard-toolbar-add-widget-button")).toBeDisabled();
  });

  it("does not let widgets be added to a dashboard that is shared with the user", () => {
    dashboard.shared = true;

    render(<DashboardToolbar />);

    expect(screen.getByTestId("dashboard-toolbar-add-widget-button")).toBeDisabled();
  });
});
