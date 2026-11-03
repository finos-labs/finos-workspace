import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import {
  forwardRef,
  memo,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { TreeItem, TreeItemRenderContext } from "react-complex-tree";
import { useNavigate } from "react-router-dom";
import DashboardPopup from "~/components/LayoutAuth/DropdownSubs/DashboardPopup";
import FolderPopup from "~/components/LayoutAuth/DropdownSubs/FolderPopup";
import { TOOLTIP_OPEN_DELAY_MS } from "~/lib/constants";
import { type SideBarItem, useAppStore, useShallowAppStore } from "~/lib/state/app";
import { useShallowSidebarStore } from "~/lib/state/sidebar";
import { useToastStore } from "~/lib/state/toast";
import { cn, formatDate } from "~/lib/utils";
import { NotificationId, showNotificationWithRememberMe } from "~/lib/utils/toast";
import Icon from "../Icon";
import Tooltip, { TooltipProvider } from "../Tooltip";

function getItemTooltip(item: SideBarItem, collapsed: boolean) {
  if (!item) return "";
  if (!collapsed) {
    if (item.isFolder) return item.data?.name;

    return <TooltipContent item={item} />;
  }
  let path = item.data?.name;
  const items = useAppStore.getState().items ?? {};
  let parentItem = item.parentId ? items[item.parentId] : undefined;

  while (parentItem && !parentItem.isRoot) {
    path = `${parentItem.data?.name} / ${path}`;

    parentItem = parentItem.parentId ? items[parentItem.parentId] : undefined;
  }

  return path;
}

function TooltipContent({ item }: { item: SideBarItem }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div>
        <strong>Created:</strong>{" "}
        {item.created_date ? formatDate(new Date(item.created_date)) : "N/A"}
      </div>
      {item.updated_date && (
        <div>
          <strong>Last update:</strong> {formatDate(new Date(item.updated_date))}
        </div>
      )}
    </div>
  );
}

function getNotificationId(
  isFolder: boolean,
  isShared: boolean,
): NotificationId | undefined {
  if (isFolder) return undefined;

  if (
    isShared &&
    !useToastStore
      .getState()
      .getToastDontShowAgain(NotificationId.DeleteDashboardShared)
  )
    return NotificationId.DeleteDashboardShared;

  return NotificationId.DeleteDashboard;
}

function hasActiveChild(
  item: TreeItem | SideBarItem,
  activeItem: TreeItem["index"] | null,
  getSideBarItem: (id: string) => SideBarItem | undefined,
): boolean {
  if (!item?.isFolder) return item?.index === activeItem;

  const childrenSideBarItems = (item.children ?? [])
    .map((childId) => getSideBarItem(String(childId)))
    .filter((child): child is SideBarItem => child !== undefined);

  let hasActive = false;
  while (hasActive === false) {
    for (const child of childrenSideBarItems) {
      hasActive ||= child.index === activeItem;
      if (child.isFolder) {
        hasActive ||= hasActiveChild(child, activeItem, getSideBarItem);
      }
    }
    break;
  }

  return hasActive;
}

const SelectionDropdown = memo(
  ({
    open,
    setOpen,
    item,
    depth,
    deleteItem,
    collapsed,
  }: {
    open: boolean;
    setOpen: (open: boolean) => void;
    item: SideBarItem;
    depth: number;
    deleteItem: (item: SideBarItem) => void;
    collapsed: boolean;
  }) => {
    return (
      <DropdownMenuPrimitive.Root open={open} onOpenChange={setOpen} modal={true}>
        <DropdownMenuPrimitive.Trigger
          className={cn(
            "transition-opacity duration-200 group-hover:opacity-100 cursor-pointer",
            { "opacity-100": open, "opacity-0 max-md:opacity-100": !open },
          )}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <Icon id="dots-horizontal" className="w-4 text-light-600! dark:text-white!" />
        </DropdownMenuPrimitive.Trigger>
        <DropdownMenuPrimitive.Portal>
          <DropdownMenuPrimitive.Content
            align="start"
            side={collapsed ? "right" : undefined}
            sideOffset={collapsed ? 24 : undefined}
            collisionPadding={16}
            onCloseAutoFocus={(e) => e.preventDefault()}
            className={cn(
              "z-[60] data-[side=bottom]:animate-slide-down data-[side=top]:animate-slide-up",
              "w-48",
              "ws-dropdown-container",
            )}
          >
            {item.isFolder ? (
              <FolderPopup
                item={item}
                deleteItem={deleteItem}
                depth={depth}
                setOpen={setOpen}
              />
            ) : (
              <DashboardPopup
                item={item}
                deleteItem={deleteItem}
                depth={depth}
                setOpen={setOpen}
              />
            )}
          </DropdownMenuPrimitive.Content>
        </DropdownMenuPrimitive.Portal>
      </DropdownMenuPrimitive.Root>
    );
  },
);

SelectionDropdown.displayName = "SelectionDropdown";

const TabItem = forwardRef<
  HTMLLIElement,
  {
    item: TreeItem<SideBarItem["data"]>;
    depth: number;
    children: ReactNode;
    title: ReactNode;
    arrow: ReactNode;
    context: Pick<
      TreeItemRenderContext<never>,
      | "toggleExpandedState"
      | "isExpanded"
      | "isDraggingOver"
      | "canDropOn"
      | "interactiveElementProps"
      | "itemContainerWithoutChildrenProps"
      | "itemContainerWithChildrenProps"
    >;
  }
>((props, _ref) => {
  const collapsed = useShallowSidebarStore((state) => !state.effectiveExpanded);

  const { title, arrow, depth, context, children, item } = props;

  const navigate = useNavigate();
  const { getSideBarItem, getLastInnerTab, removeTab, deleteFolder } =
    useShallowAppStore((state) => ({
      getSideBarItem: state.getSideBarItem,
      getLastInnerTab: state.getLastInnerTab,
      removeTab: state.removeTab,
      deleteFolder: state.deleteFolder,
    }));

  const { isActive, setActiveItem } = useShallowSidebarStore((state) => ({
    isActive: hasActiveChild(item, state.activeItem, getSideBarItem),
    setActiveItem: state.setActiveItem,
  }));

  const sidebarCollapsed = useShallowSidebarStore(
    (state) => !state.expandedMyDashboards,
  );

  const [open, setOpen] = useState(false);

  const handleContextMenu = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen(true);
  }, []);

  const itemData = useMemo(() => item as SideBarItem, [Object.values(item || {})]);

  const handleDelete = useCallback(() => {
    if (item.isFolder) {
      deleteFolder(item.index as string);
      navigate("/app");
    } else {
      removeTab(item.index as string, navigate);
    }
  }, [item.index, item.isFolder, deleteFolder, removeTab, navigate]);

  const deleteItem = useCallback(
    (item: SideBarItem) => {
      if (
        !item?.data?.hasChanges &&
        (item.isFolder ? (item.children?.length ?? 0) === 0 : true)
      ) {
        if (item.isFolder) {
          deleteFolder(item.index as string);
          navigate("/app");
        } else {
          removeTab(item.index as string, navigate);
        }
        return;
      }

      const currentId = getNotificationId(
        item.isFolder ?? false,
        itemData.isShared ?? false,
      );
      const isShared = currentId === NotificationId.DeleteDashboardShared;

      showNotificationWithRememberMe({
        id: currentId,
        message: `Delete ${isShared ? "shared" : ""} ${
          item.isFolder ? "folder" : "dashboard"
        }?`,
        description: `Are you sure you want to delete this ${isShared ? "shared" : ""} ${
          item.isFolder ? "folder and all its contents" : "dashboard"
        }? This action is permanent and cannot be undone.`,
        cancel: {
          label: "Cancel",
          onClick: () => setOpen(false),
        },
        action: {
          label: "Yes, delete",
          onClick: () => {
            if (item.isFolder) {
              deleteFolder(item.index as string);
              navigate("/app");
              return;
            }
            handleDelete();
          },
        },
        toastType: "warning",
      });
    },
    [itemData, getNotificationId, handleDelete, deleteFolder, removeTab, navigate],
  );

  const onClick = useCallback(() => {
    const tab = getLastInnerTab(item.index as string);
    if (item.isFolder) return context.toggleExpandedState();

    setActiveItem(item.index);
    queueMicrotask(() => navigate(`/app/${item.index}${tab && `?tab=${tab}`}`));
  }, [
    context.toggleExpandedState,
    item.isFolder,
    item.index,
    itemData.data,
    navigate,
    getLastInnerTab,
  ]);

  const onClickDelete = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      deleteItem(itemData);
    },
    [deleteItem, itemData],
  );

  const tooltipMessage = useMemo(
    () => itemData && getItemTooltip(itemData, collapsed),
    [itemData, collapsed],
  );
  const selectionMemo = useMemo(
    () => (
      <SelectionDropdown
        key={`selection-dropdown-${item.index}`}
        open={open}
        setOpen={setOpen}
        item={itemData}
        depth={depth}
        deleteItem={deleteItem}
        collapsed={collapsed}
      />
    ),
    [open, setOpen, item.index, itemData, depth, deleteItem, collapsed],
  );

  const liElementRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    if (liElementRef.current)
      liElementRef.current.style.paddingLeft = `${(collapsed ? 1 : depth + 1) * 0.5}rem`;
  }, [liElementRef, collapsed, depth]);

  const tooltipContent = useMemo(
    () => (
      <li
        role="treeitem"
        style={{
          paddingLeft: `${(collapsed ? 1 : depth + 1) * 0.5}rem`,
        }}
        ref={liElementRef}
        onContextMenu={handleContextMenu}
        id={`tab-${item.index}`}
        aria-label={"dashboard"}
        className={cn(
          "ws-navigation-item group relative w-full justify-between",
          "@min-[100px]:title-container @max-[100px]:h-8 @max-[100px]:w-8!",
          "@max-[100px]:hover:bg-light-200 @max-[100px]:dark:hover:bg-dark-500",
          {
            "bg-general-bg-secondary": open,
            "ws-navigation-item-active":
              (isActive && !(item.isFolder && context.isExpanded)) ||
              (context.isDraggingOver && context.canDropOn && item.isFolder),
            "drag-over": context.isDraggingOver && context.canDropOn && item.isFolder,
            "folder-drop-target":
              context.isDraggingOver && context.canDropOn && item.isFolder,
            hidden: sidebarCollapsed && !isActive,
          },
        )}
        {...context.itemContainerWithoutChildrenProps}
        {...context.interactiveElementProps}
        onClick={onClick}
      >
        <span className="flex items-center gap-0.5 w-full overflow-hidden">
          {item.isFolder ? (
            context.isExpanded ? (
              <Icon id="folder-open" className="h-4 min-w-[16px] flex-shrink-0" />
            ) : (
              <Icon id="folder-closed" className="h-4 min-w-[16px] flex-shrink-0" />
            )
          ) : (
            <Icon
              id={itemData.isShared ? "dashboard-shared" : "file-04"}
              className={cn("min-w-[16px] flex-shrink-0", {
                "text-brand-main dark:text-brand-lighter": !itemData.isShared,
                "text-[#F97316]! dark:text-[#F97316]!": itemData.isShared,
              })}
            />
          )}
          <span
            className={cn(
              "@max-[100px]:hidden flex flex-col gap-0.5 pl-1 overflow-hidden",
              { "w-full": !item.isFolder },
            )}
          >
            <span
              className={cn(
                "truncate text-light-700 dark:text-light-300 select-none",
                "@min-[100px]:mr-4 w-full max-w-[calc(100%-10px)]",
                {
                  "max-md:max-w-[calc(100%-36px)] group-hover:max-w-[calc(100%-36px)]":
                    !item.isFolder,
                  "max-w-[calc(100%-36px)]": !item.isFolder && open,
                  "text-black! dark:text-white!":
                    isActive && !(item.isFolder && context.isExpanded),
                },
              )}
            >
              {title}
            </span>
          </span>
          <span className="@max-[100px]:hidden flex items-center justify-center flex-shrink-0">
            {arrow}
          </span>
        </span>

        <span className="@max-[100px]:invisible @max-[100px]:pointer-events-none absolute right-1 flex gap-1 z-50">
          {selectionMemo}
          <span
            className={cn("transition-opacity duration-200 group-hover:opacity-100", {
              "opacity-100": open,
              "opacity-0 max-md:opacity-100": !open,
            })}
            onClick={onClickDelete}
          >
            <Icon id="trash-04" className="w-4 !text-light-600 dark:!text-white" />
          </span>
        </span>
      </li>
    ),
    [
      liElementRef,
      isActive,
      sidebarCollapsed,
      context.isExpanded,
      context.isDraggingOver,
      context.canDropOn,
      context.interactiveElementProps,
      context.itemContainerWithoutChildrenProps,
      title,
      arrow,
      onClick,
      selectionMemo,
      open,
      onClickDelete,
      handleContextMenu,
    ],
  );

  const hasData = itemData !== undefined;

  const tooltipMemo = useMemo(
    () => (
      <TooltipProvider delayDuration={TOOLTIP_OPEN_DELAY_MS} skipDelayDuration={0}>
        <Tooltip
          id={`tab-${item.index}-tooltip`}
          key={`tab-${item.index}-tooltip`}
          message={tooltipMessage}
          hide={open}
          position="right"
        >
          {tooltipContent}
        </Tooltip>
      </TooltipProvider>
    ),
    [tooltipMessage, open, collapsed, tooltipContent, item.index],
  );
  return useMemo(
    () =>
      hasData ? (
        <div
          className={cn({
            "border dark:border-dark-500 border-light-200 bg-light-100 dark:bg-dark-750 rounded p-0.5":
              item.isFolder && collapsed && context.isExpanded,
            hidden: sidebarCollapsed && !isActive,
          })}
        >
          {tooltipMemo}

          {children}
        </div>
      ) : null,
    [
      hasData,
      isActive,
      sidebarCollapsed,
      context.isExpanded,
      collapsed,
      item?.isFolder,
      tooltipMemo,
      children,
    ],
  );
});

TabItem.displayName = "TabItem";

export default memo(TabItem);
