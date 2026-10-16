import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import clsx from "clsx";
import { Fragment, memo, useCallback, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import MoveTo from "~/components/LayoutAuth/DropdownSubs/MoveTo";
import Tooltip from "~/components/Tooltip";
import { canShare, useShallowAccessStore } from "~/lib/state/access";
import { type SideBarItem, useShallowAppStore } from "~/lib/state/app";
import { useShallowThemeStore } from "~/lib/state/theme";
import { dispatchSaveState } from "~/lib/utils";

type PopupMenuItem = {
  shortcut: string;
  label: string;
  color?: string;
  action?: () => void;
  disabled?: boolean;
  disabledTooltip?: string;
};

type DashboardPopupProps = {
  item: SideBarItem;
  deleteItem: (item: SideBarItem) => void;
  depth: number;
  setOpen?: (value: boolean) => void;
};

export function DashboardPopup(props: DashboardPopupProps) {
  const { item, deleteItem, depth, setOpen } = props;

  const { id } = useParams();
  const navigate = useNavigate();

  const {
    toggleExportPopup,
    setRenamePopup,
    setShareDashboardPopupId,
    setExcelExportPopup,
    setExcelExportItem,
    setExportTemplatePopup,
    setGroupingVisible,
    setGenerateAppDashboardId,
    groupingVisible,
  } = useShallowThemeStore((s) => ({
    toggleExportPopup: s.toggleExportPopup,
    setRenamePopup: s.setRenamePopup,
    setShareDashboardPopupId: s.setShareDashboardPopupId,
    setExcelExportPopup: s.setExcelExportPopup,
    setExcelExportItem: s.setExcelExportItem,
    setExportTemplatePopup: s.setExportTemplatePopup,
    setGroupingVisible: s.setGroupingVisible,
    setGenerateAppDashboardId: s.setGenerateAppDashboardId,
    groupingVisible: s.groupingVisible,
  }));

  const { duplicateTab, moveTabToFolder, getTabById } = useShallowAppStore((s) => ({
    duplicateTab: s.duplicateTab,
    moveTabToFolder: s.moveTabToFolder,
    getTabById: s.getTabById,
  }));

  const { mayShare, excelAddIn } = useShallowAccessStore((state) => ({
    mayShare: canShare(state.access),
    excelAddIn: !!state.access?.excel_add_in,
  }));

  const hasAdvancedBackendWidgets = useMemo(() => {
    const tab = getTabById(item.index);
    return (
      tab?.data?.widgets?.some(
        (widget) => widget.connectionType === "advanced-backend",
      ) ?? false
    );
  }, [getTabById, item.index]);

  const handleExportTemplate = useCallback(() => {
    const currentDashboardData = getTabById(item.index)?.data;

    if (!currentDashboardData) {
      console.error("No dashboard data available to create a template.");
      return;
    }
    dispatchSaveState();
    setExportTemplatePopup(true);
  }, [getTabById, item.index, setExportTemplatePopup]);

  const tabMenuItems = useMemo<PopupMenuItem[]>(
    () => [
      {
        shortcut: "t",
        label: "Rename",
        action: () => {
          setRenamePopup(true, item.data.name, item.index, "tab");
        },
      },
      {
        shortcut: "t",
        label: "Move to",
      },
      {
        shortcut: "t",
        label: "Duplicate",
        action: () => {
          const tabId = duplicateTab(item.index);
          if (tabId) navigate(`/app/${tabId}`);
        },
      },
      {
        shortcut: "t",
        label: "Open in a new window",
        action: () => {
          window.open(`/app/${item.index}`, "_blank");
        },
      },
      ...(mayShare
        ? [
            {
              shortcut: "t",
              label: "Share",
              action: () => {
                setShareDashboardPopupId(item.index);
              },
            },
          ]
        : []),
      {
        shortcut: "t",
        label: "Delete",
        color: "text-red-500!",
        action: () => {
          deleteItem(item);
        },
      },
      {
        shortcut: "t",
        label: "Export PDF",
        disabled: item.index !== id,
        action: toggleExportPopup,
      },
      ...(import.meta.env.VITE_EXCEL_ADD_IN_ENABLED === "true" && excelAddIn
        ? [
            {
              shortcut: "e",
              label: "Export to Excel",
              action: () => {
                setExcelExportItem(item);
                setExcelExportPopup(true);
              },
              disabled: !hasAdvancedBackendWidgets,
              disabledTooltip: "No Excel-compatible widgets found in this dashboard",
            },
          ]
        : []),
      {
        shortcut: "t",
        label: "Export apps.json",
        action: handleExportTemplate,
        disabled: !hasAdvancedBackendWidgets,
        disabledTooltip: "No backend sources found in this dashboard",
      },
      {
        shortcut: "t",
        label: "Save App",
        action: () => setGenerateAppDashboardId(item.index),
      },
      {
        shortcut: "t",
        label: `${groupingVisible ? "Hide" : "Show"} grouping`,
        action: () => {
          setGroupingVisible(!groupingVisible);
        },
      },
    ],
    [
      deleteItem,
      duplicateTab,
      handleExportTemplate,
      id,
      mayShare,
      excelAddIn,
      item,
      moveTabToFolder,
      navigate,
      setExcelExportItem,
      setExcelExportPopup,
      setGenerateAppDashboardId,
      setGroupingVisible,
      setRenamePopup,
      setShareDashboardPopupId,
      toggleExportPopup,
      groupingVisible,
      hasAdvancedBackendWidgets,
    ],
  );

  return (
    <div key={`dashboard-popup-${item.index}`}>
      {tabMenuItems.map(
        ({ label, color, action: actionCb, disabled, disabledTooltip }, i) =>
          label === "Move to" ? (
            <MoveTo
              key={`${label}-${i}`}
              label={label}
              color={color}
              depth={depth}
              itemData={item}
            />
          ) : (
            <Fragment key={`${label}-${i}`}>
              {(label === "Export PDF" || label === "Export apps.json") && (
                <DropdownMenuPrimitive.Separator className="my-1 h-px w-full bg-light-200 dark:bg-[#36363F]" />
              )}
              {disabled ? (
                <Tooltip
                  message={
                    disabledTooltip ||
                    "You need to be inside the dashboard to be able to use this feature."
                  }
                  position="right"
                >
                  <DropdownMenuPrimitive.Item
                    onClick={(e) => e.stopPropagation()}
                    className="ws-dropdown-item hover:bg-transparent! dark:hover:bg-transparent! opacity-50 cursor-not-allowed"
                  >
                    <span className={clsx("grow", color)}>{label}</span>
                  </DropdownMenuPrimitive.Item>
                </Tooltip>
              ) : (
                <DropdownMenuPrimitive.Item
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    actionCb?.();
                    setOpen?.(false);
                  }}
                  className="ws-dropdown-item"
                >
                  <span className={clsx("grow", color)}>{label}</span>
                </DropdownMenuPrimitive.Item>
              )}
            </Fragment>
          ),
      )}
    </div>
  );
}

export default memo(DashboardPopup);
