import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import useIsMobile from "~/hooks/useIsMobile";
import { useAppStore } from "~/lib/state/app";
import { useShallowFeatureFlagsStore } from "~/lib/state/featureFlags";
import { useShallowThemeStore } from "~/lib/state/theme";
import { cn, dispatchSaveState } from "~/lib/utils";
import type { ExtraActionT } from "./DraggableCard/NavBar";
import FeatureLock from "./General/FeatureLock";
import Icon from "./Icon";
import { MoveToTabsDropdownMenu } from "./MoveToDropDown";
import type { EllipsisDropdownMenuProps } from "./MoveToDropDown/types";
import { getExportFns } from "./MoveToDropDown/utils";
import Tooltip from "./Tooltip";
import { useWidgetContext } from "./Widget.context";

export default function EllipsisDropdownMenu(props: EllipsisDropdownMenuProps) {
  const { dispatch, settings, exportFns, onExport, isMinimized, onMinimizeToggle } =
    props;

  const extraSettings = useMemo<ExtraActionT[]>(
    () => props.extraSettings || [],
    [props.extraSettings],
  );
  const { widgetRef, widgetFromJSON, activeDashboardId, isShared, isPreview } =
    useWidgetContext();
  const setExportWidgetData = useShallowThemeStore(
    (state) => state.setExportWidgetData,
  );
  const isMobile = useIsMobile();
  const isFullTier = useShallowFeatureFlagsStore(
    (state) => state.featureFlags?.tier === "full",
  );

  const exportFunctions = useMemo(() => getExportFns(exportFns), [exportFns]);

  const duplicateWidgetCallback = useCallback(async () => {
    await dispatchSaveState();
    const widget = useAppStore
      .getState()
      .getTabWidgetById(activeDashboardId, widgetRef.current?.id);
    if (!widget) return toast.error("Widget not found");

    useAppStore.getState().duplicateWidget(activeDashboardId, widget);
    setTimeout(() => {
      const element =
        document.getElementsByClassName("react-grid-layout")?.[0].lastElementChild;
      element?.scrollIntoView();
    }, 500);
  }, [activeDashboardId]);

  const defaultItems = useMemo(() => {
    const regularItems = [];
    const fullTierItems = [];
    const widget = widgetRef.current;

    if (settings?.showMetadata) {
      regularItems.push(
        <DropdownMenuPrimitive.Item
          key={`${widget?.id}-metadata`}
          className="ws-dropdown-item"
          onSelect={() => {
            dispatch({ metadataModal: true });
          }}
        >
          <Icon id="metadata-icon" key={`${widget?.id}-metadata-icon`} />
          Metadata
        </DropdownMenuPrimitive.Item>,
      );
    }
    if (settings?.showSettings) {
      regularItems.push(
        <DropdownMenuPrimitive.Item
          key={`${widget?.id}-settings`}
          className="ws-dropdown-item"
          onSelect={() => {
            dispatch({ settingsModal: true });
          }}
        >
          <Icon id="cog-icon" key={`${widget?.id}-settings-icon`} />
          Settings
        </DropdownMenuPrimitive.Item>,
      );
    }
    // Only show Parameters for backend widgets (external === true), not built-in ones
    if ((widget?.params?.length ?? 0) > 0 && widget?.external) {
      regularItems.push(
        <DropdownMenuPrimitive.Item
          key={`${widget?.id}-parameters`}
          className="ws-dropdown-item"
          onSelect={() => {
            dispatch({ parametersModal: true });
          }}
        >
          <Icon id="filters-icon" key={`${widget?.id}-parameters-icon`} />
          Parameters
        </DropdownMenuPrimitive.Item>,
      );
    }
    if (settings?.showDuplicate) {
      regularItems.push(
        <DropdownMenuPrimitive.Item
          key={`${widget?.id}-duplicate`}
          className={cn("ws-dropdown-item", {
            "opacity-30": isShared,
          })}
          onSelect={() => duplicateWidgetCallback()}
          disabled={isShared}
        >
          <Icon id="duplicate-icon" />
          Duplicate
        </DropdownMenuPrimitive.Item>,
      );
    }
    if (settings?.showMove) {
      regularItems.push(<MoveToTabsDropdownMenu key={`${widget?.id}-move`} />);
    }
    if (settings?.showMinimize && onMinimizeToggle) {
      regularItems.push(
        <DropdownMenuPrimitive.Item
          key={`${widget?.id}-minimize`}
          className={cn("ws-dropdown-item", {
            "opacity-30": isShared,
          })}
          onSelect={onMinimizeToggle}
          disabled={isShared}
        >
          <Icon id={isMinimized ? "expand-03" : "minimize-03"} />
          {isMinimized ? "Expand" : "Minimize"}
        </DropdownMenuPrimitive.Item>,
      );
    }
    // Full tier items
    if (settings?.showExport) {
      const isExportable = (widgetFromJSON?.exportable ?? widget?.exportable) !== false;
      fullTierItems.push(
        <FeatureLock isLocked={!isFullTier} key={`${widget?.id}-export-lock`}>
          <DropdownMenuPrimitive.Item
            key={`export-${widget?.id}`}
            className={cn("ws-dropdown-item", {
              "opacity-30": !isExportable,
            })}
            disabled={!isExportable}
            onSelect={() => {
              if (onExport) {
                onExport();
                return;
              }
              setExportWidgetData({
                possibleExportFormats: exportFns ? exportFunctions : [],
                widgetId: widget.id,
                widgetName: widget.name,
                selectedExportFormat: exportFns ? exportFunctions[0].value : "",
              });
            }}
          >
            <Icon id="download-icon" key={`export-${widget?.id}-icon`} />
            Export
          </DropdownMenuPrimitive.Item>
        </FeatureLock>,
      );
    }

    return { regularItems, fullTierItems };
  }, [
    settings,
    widgetRef,
    isShared,
    exportFunctions,
    exportFns,
    onExport,
    setExportWidgetData,
    dispatch,
    duplicateWidgetCallback,
    isFullTier,
    isMinimized,
    onMinimizeToggle,
  ]);

  const dropDownItems = useMemo(() => {
    const { regularItems, fullTierItems } = defaultItems;
    const widget = widgetRef.current;

    // Process extra settings
    const extras = extraSettings
      .filter((item) => {
        if (item.hide) return false;
        if (item.showId && !settings?.[item.showId]) return false;
        return true;
      })
      .map((item, index) => {
        const childKey = `${widget?.id}-${item.id}`;

        if (item.children) {
          return (
            <DropdownMenuPrimitive.Sub key={childKey}>
              <DropdownMenuPrimitive.SubTrigger
                className="ws-dropdown-item"
                key={`${childKey}-sub-trigger`}
              >
                <Icon id={item.icon} key={`${childKey}-${item.icon}`} />
                {item.label}
                <Icon
                  id="chevron-right"
                  className="ml-auto w-[12px] h-[18px]"
                  key={`${childKey}-chevron`}
                />
              </DropdownMenuPrimitive.SubTrigger>
              <DropdownMenuPrimitive.SubContent
                key={`${childKey}-content`}
                className="ws-dropdown-container z-50 w-[172px]"
              >
                {item.children
                  .filter((child) => !child.hide)
                  .map((child) => {
                    const element = (
                      <DropdownMenuPrimitive.Item
                        key={`${childKey}-${child.id}`}
                        className={cn({
                          "ws-dropdown-item": !child.disabled,
                          "ws-dropdown-item-noclick opacity-30 select-none":
                            child.disabled,
                        })}
                        onSelect={child.onClick}
                        disabled={child.disabled}
                      >
                        <Icon
                          id={child.icon}
                          key={`${childKey}-${child.id}-${child.icon}`}
                        />
                        {child.label}
                      </DropdownMenuPrimitive.Item>
                    );

                    if (child.tooltipMessage) {
                      return (
                        <Tooltip
                          key={`${childKey}-${child.id}-tooltip`}
                          className="max-w-[180px] whitespace-pre-wrap break-words"
                          message={child.tooltipMessage}
                          position="right"
                        >
                          {element}
                        </Tooltip>
                      );
                    }
                    return element;
                  })}
              </DropdownMenuPrimitive.SubContent>
            </DropdownMenuPrimitive.Sub>
          );
        }
        return (
          <DropdownMenuPrimitive.Item
            key={`${childKey}-${index}`}
            className="ws-dropdown-item"
            onSelect={() => {
              item.onClick?.();
            }}
          >
            <Icon id={item.icon} key={`${childKey}-${item.icon}`} />
            {item.label}
          </DropdownMenuPrimitive.Item>
        );
      });

    // Combine all items in the desired order: regular items -> extras -> full tier items
    return [...regularItems, ...extras, ...fullTierItems];
  }, [defaultItems, settings, extraSettings, widgetRef]);

  return (
    <DropdownMenuPrimitive.Root modal={false}>
      <Tooltip
        message={isPreview ? "Options are not available in preview mode" : "Options"}
        hide={isMobile}
      >
        <DropdownMenuPrimitive.Trigger
          className={cn("ws-small-navbar-btn", {
            "opacity-30": isPreview,
          })}
          disabled={isPreview}
        >
          <Icon id="list-unordered" />
        </DropdownMenuPrimitive.Trigger>
      </Tooltip>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          onCloseAutoFocus={(e) => e.preventDefault()}
          align="end"
          sideOffset={5}
          className="ws-dropdown-container z-50 w-[172px]"
        >
          {dropDownItems}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
