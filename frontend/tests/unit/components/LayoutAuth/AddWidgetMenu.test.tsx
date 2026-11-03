import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AddWidgetMenu from "~/components/LayoutAuth/AddWidgetMenu";

const dashboard = vi.hoisted(() => ({ locked: false, shared: false }));

vi.mock("react-router-dom", () => ({ useParams: () => ({ id: "dash-1" }) }));

vi.mock("~/lib/state/app", () => ({
  DASHBOARD_LOCKED_MESSAGE: "Locked.",
  useIsDashboardLocked: () => dashboard.locked,
  useShallowAppStore: (
    selector: (state: { isDashboardShared: () => boolean }) => unknown,
  ) => selector({ isDashboardShared: () => dashboard.shared }),
}));

vi.mock("~/lib/state/sharedApp", () => ({
  useSharedAppStore: () => ({
    sharedItems: dashboard.shared ? { "dash-1": {} } : {},
  }),
}));

vi.mock("~/lib/state/theme", () => ({
  useThemeStore: () => ({
    toggleSearch: vi.fn(),
    quickAddButtonVisible: true,
    setInitialSelectedSearchTab: vi.fn(),
  }),
}));

vi.mock("~/components/DataConnectors/Providers/DataConnectorContext", () => ({
  useDataConnectorContext: () => ({ setOpen: vi.fn() }),
}));

vi.mock("~/components/Tooltip", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("~/components/Icon", () => ({
  default: ({ id }: { id: string }) => <span data-testid={`icon-${id}`} />,
}));

describe("AddWidgetMenu", () => {
  beforeEach(() => {
    dashboard.locked = false;
    dashboard.shared = false;
  });

  it("offers to add widgets to an unlocked dashboard", () => {
    render(<AddWidgetMenu />);

    expect(screen.getByRole("button")).toBeEnabled();
    expect(screen.getByTestId("icon-plus-icon")).toBeInTheDocument();
  });

  it("shows a disabled lock instead on a locked dashboard", () => {
    dashboard.locked = true;

    render(<AddWidgetMenu />);

    expect(screen.getByRole("button")).toBeDisabled();
    expect(screen.getByTestId("icon-locker")).toBeInTheDocument();
    expect(screen.queryByTestId("icon-plus-icon")).not.toBeInTheDocument();
  });

  it("shows the same lock on a dashboard that is shared with the user", () => {
    dashboard.shared = true;

    render(<AddWidgetMenu />);

    expect(screen.getByRole("button")).toBeDisabled();
    expect(screen.getByTestId("icon-locker")).toBeInTheDocument();
  });
});
