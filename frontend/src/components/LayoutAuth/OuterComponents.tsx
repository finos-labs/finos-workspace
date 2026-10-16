import { useMobile } from "~/lib/providers/MobileProvider";
import { canShare, useShallowAccessStore } from "~/lib/state/access";
import { useShallowThemeStore } from "~/lib/state/theme";
import { AddCopilotDialog } from "../AI/AddCopilotDialog";
import AddSkillDialog from "../AI/AddSkillDialog";
import { CreateWidgetMetadataDialog } from "../AI/CreateWidgetMetadataDialog";
import McpAuthPopup from "../AI/hooks/mcp/McpAuthPopup";
import { McpConnectionManager } from "../AI/McpConnectionManager";
import { WorkspaceBridgeConnectionManager } from "../AI/WorkspaceBridgeConnectionManager";
import ManageAppDialog from "../Apps/ManageAppDialog";
import ManageAppsDialog from "../Apps/ManageAppsDialog";
import AddConnectionModal from "../DataConnectors/AddConnectionModal";
import CreateFolderPopup from "../General/CreateFolderPopup";
import ExportFolderDialog from "../General/ExportFolderDialog";
import ExportModal from "../General/ExportModal";
import ExportTemplatePopup from "../General/ExportTemplatePopup";
import ExportWidgetModal from "../General/ExportWidgetModal";
import InvalidItemsDialog from "../General/InvalidItemsDialog";
import RenamePopup from "../General/RenamePopup";
import { SaveAppDialog } from "../General/SaveAppDialog";
import { ShareUserAppDialog } from "../General/SharedAppsDialog";
import { ShareDashboardDialog } from "../General/SharedDashboardDialog";
import ExcelExportDialog from "../LayoutAuth/DropdownSubs/ExcelExportDialog";
import AddPromptDialog from "./PromptLibrary/AddPromptDialog";
import SearchDialog from "./Search/SearchDialog";
import ShortcutDialog from "./ShortcutDialog";

export default function OuterComponents() {
  const {
    exportWidgetData,
    exportPopup,
    renamePopup,
    shortcutSidebarOpen,
    search,
    shareDashboardPopupId,
    shareUserAppsPopupId,
    excelExportPopup,
    exportFolderPopup,
  } = useShallowThemeStore((state) => ({
    exportWidgetData: state.exportWidgetData,
    exportPopup: state.exportPopup,
    renamePopup: state.renamePopup,
    shortcutSidebarOpen: state.shortcutSidebarOpen,
    search: state.search,
    shareDashboardPopupId: state.shareDashboardPopupId,
    shareUserAppsPopupId: state.shareUserAppsPopupId,
    excelExportPopup: state.excelExportPopup,
    exportFolderPopup: state.exportFolderPopup,
  }));

  const isMobile = useMobile((s) => s.isMobile);
  const { mayShare, excelAddIn } = useShallowAccessStore((state) => ({
    mayShare: canShare(state.access),
    excelAddIn: !!state.access?.excel_add_in,
  }));

  return (
    <>
      <AddCopilotDialog />
      <AddConnectionModal />
      <InvalidItemsDialog />
      <AddPromptDialog />
      <AddSkillDialog />
      <ManageAppsDialog />
      <ManageAppDialog />
      <SaveAppDialog />
      <McpAuthPopup />
      {search && !isMobile && <SearchDialog />}
      {shortcutSidebarOpen && <ShortcutDialog />}
      {exportPopup && <ExportModal />}
      {exportWidgetData && <ExportWidgetModal />}
      {renamePopup && <RenamePopup />}
      <ExportTemplatePopup />
      <CreateFolderPopup />
      {mayShare && shareDashboardPopupId && <ShareDashboardDialog />}
      {mayShare && shareUserAppsPopupId && <ShareUserAppDialog />}
      {excelAddIn && excelExportPopup && <ExcelExportDialog />}
      {exportFolderPopup && <ExportFolderDialog />}
      <McpConnectionManager />
      <WorkspaceBridgeConnectionManager />
      <CreateWidgetMetadataDialog />
    </>
  );
}
