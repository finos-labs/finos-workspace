import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OuterComponents from "~/components/LayoutAuth/OuterComponents";
import type { SharingLevel } from "~/lib/state/access";
import { setAccess } from "../../factories";

// The share and Excel export dialogs have been asked for
vi.mock("~/lib/state/theme", () => ({
  useShallowThemeStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      shareDashboardPopupId: "dash-1",
      shareUserAppsPopupId: "app-1",
      excelExportPopup: true,
    }),
}));

vi.mock("~/lib/providers/MobileProvider", () => ({
  useMobile: (selector: (state: { isMobile: boolean }) => unknown) =>
    selector({ isMobile: false }),
}));

vi.mock("~/components/General/SharedDashboardDialog", () => ({
  ShareDashboardDialog: () => <div data-testid="share-dashboard-dialog" />,
}));
vi.mock("~/components/General/SharedAppsDialog", () => ({
  ShareUserAppDialog: () => <div data-testid="share-app-dialog" />,
}));
vi.mock("~/components/LayoutAuth/DropdownSubs/ExcelExportDialog", () => ({
  default: () => <div data-testid="excel-export-dialog" />,
}));

vi.mock("~/components/AI/AddSkillDialog", () => ({ default: () => null }));
vi.mock("~/components/AI/CreateWidgetMetadataDialog", () => ({
  CreateWidgetMetadataDialog: () => null,
}));
vi.mock("~/components/AI/hooks/mcp/McpAuthPopup", () => ({ default: () => null }));
vi.mock("~/components/AI/McpConnectionManager", () => ({
  McpConnectionManager: () => null,
}));
vi.mock("~/components/AI/WorkspaceBridgeConnectionManager", () => ({
  WorkspaceBridgeConnectionManager: () => null,
}));
vi.mock("~/components/Apps/ManageAppDialog", () => ({ default: () => null }));
vi.mock("~/components/Apps/ManageAppsDialog", () => ({ default: () => null }));
vi.mock("~/components/DataConnectors/AddConnectionModal", () => ({
  default: () => null,
}));
vi.mock("~/components/General/CreateFolderPopup", () => ({ default: () => null }));
vi.mock("~/components/General/ExportFolderDialog", () => ({ default: () => null }));
vi.mock("~/components/General/ExportModal", () => ({ default: () => null }));
vi.mock("~/components/General/ExportTemplatePopup", () => ({ default: () => null }));
vi.mock("~/components/General/ExportWidgetModal", () => ({ default: () => null }));
vi.mock("~/components/General/InvalidItemsDialog", () => ({ default: () => null }));
vi.mock("~/components/General/RenamePopup", () => ({ default: () => null }));
vi.mock("~/components/General/SaveAppDialog", () => ({ SaveAppDialog: () => null }));
vi.mock("~/components/LayoutAuth/PromptLibrary/AddPromptDialog", () => ({
  default: () => null,
}));
vi.mock("~/components/LayoutAuth/Search/SearchDialog", () => ({ default: () => null }));
vi.mock("~/components/LayoutAuth/ShortcutDialog", () => ({ default: () => null }));

describe("OuterComponents", () => {
  beforeEach(() => {
    setAccess();
  });

  it("opens the share dialogs for a user whose roles allow sharing", () => {
    setAccess({ sharing: "share" });
    render(<OuterComponents />);

    expect(screen.getByTestId("share-dashboard-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("share-app-dialog")).toBeInTheDocument();
  });

  it.each<SharingLevel>([
    "none",
    "receive",
  ])("opens no share dialog for a user whose sharing is %s", (sharing) => {
    setAccess({ sharing });
    render(<OuterComponents />);

    expect(screen.queryByTestId("share-dashboard-dialog")).not.toBeInTheDocument();
    expect(screen.queryByTestId("share-app-dialog")).not.toBeInTheDocument();
  });

  it("opens the Excel export only when a role grants the Excel add-in", () => {
    setAccess({ excel_add_in: false });
    const { unmount } = render(<OuterComponents />);
    expect(screen.queryByTestId("excel-export-dialog")).not.toBeInTheDocument();
    unmount();

    setAccess({ excel_add_in: true });
    render(<OuterComponents />);
    expect(screen.getByTestId("excel-export-dialog")).toBeInTheDocument();
  });
});
