import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardPopup } from "~/components/LayoutAuth/DropdownSubs/DashboardPopup";
import type { SharingLevel } from "~/lib/state/access";
import type { SideBarItem } from "~/lib/state/app";
import { makeItem, makeWidget, setAccess } from "../../../factories";

const theme = vi.hoisted(() => ({
  toggleExportPopup: vi.fn(),
  setRenamePopup: vi.fn(),
  setShareDashboardPopupId: vi.fn(),
  setExportTemplatePopup: vi.fn(),
  setGroupingVisible: vi.fn(),
  setGenerateAppDashboardId: vi.fn(),
  groupingVisible: false,
}));

vi.mock("react-router-dom", () => ({
  useParams: () => ({ id: "dash-1" }),
  useNavigate: () => vi.fn(),
}));

vi.mock("~/lib/state/theme", () => ({
  useShallowThemeStore: (selector: (state: typeof theme) => unknown) => selector(theme),
}));

// A dashboard with a backend widget, which Export apps.json needs
const dashboard = makeItem({
  index: "dash-1",
  data: { widgets: [makeWidget({ connectionType: "advanced-backend" })] },
});

vi.mock("~/lib/state/app", () => ({
  useShallowAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      duplicateTab: vi.fn(),
      moveTabToFolder: vi.fn(),
      getTabById: () => dashboard,
    }),
}));

vi.mock("@radix-ui/react-dropdown-menu", () => ({
  Item: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <div role="menuitem" onClick={onClick}>
      {children}
    </div>
  ),
  Separator: () => <hr />,
}));

vi.mock("~/components/LayoutAuth/DropdownSubs/MoveTo", () => ({
  default: () => <div role="menuitem">Move to</div>,
}));

vi.mock("~/components/Tooltip", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const item: SideBarItem = {
  index: "dash-1",
  children: [],
  data: { name: "Markets" },
};

const renderPopup = () =>
  render(<DashboardPopup item={item} deleteItem={vi.fn()} depth={0} />);

const menuItem = (name: string) => screen.queryByRole("menuitem", { name });

describe("DashboardPopup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAccess();
  });

  it("offers Share to a user whose roles allow sharing", () => {
    setAccess({ sharing: "share" });
    renderPopup();

    fireEvent.click(menuItem("Share") as HTMLElement);

    expect(theme.setShareDashboardPopupId).toHaveBeenCalledWith("dash-1");
  });

  it.each<SharingLevel>([
    "none",
    "receive",
  ])("does not offer Share to a user whose sharing is %s", (sharing) => {
    setAccess({ sharing });
    renderPopup();

    expect(menuItem("Share")).not.toBeInTheDocument();
  });

  it("offers Export PDF and Save App to every user", () => {
    renderPopup();

    fireEvent.click(menuItem("Export PDF") as HTMLElement);
    fireEvent.click(menuItem("Save App") as HTMLElement);

    expect(theme.toggleExportPopup).toHaveBeenCalled();
    expect(theme.setGenerateAppDashboardId).toHaveBeenCalledWith("dash-1");
  });
});
