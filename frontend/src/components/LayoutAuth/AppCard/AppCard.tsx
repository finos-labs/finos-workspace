import {
  Fragment,
  memo,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
} from "react";
import { useNavigate } from "react-router-dom";
import { getUserInitials } from "~/components/AdminRoles/AddUsersSelect";
import { WidgetTooltipItem } from "~/components/AI/WidgetTooltipItem";
import { McpAppPopover } from "~/components/Apps/McpAppPopover";
import { Button } from "~/components/ds/atoms/Button";
import { cn } from "~/components/ds/utils";
import { AuthenticatedAvatar } from "~/components/General/Avatar";
import { HoverPopover } from "~/components/HoverPopover";
import Icon from "~/components/Icon";
import Tooltip from "~/components/Tooltip";
import { useStateReducer } from "~/hooks/useStateReducer";
import { getConfig } from "~/lib/runtimeConfig";
import { canAddConnections, canShare, useShallowAccessStore } from "~/lib/state/access";
import { useShallowBackendConnectorStore } from "~/lib/state/backendConnector";
import { useShallowMcpToolsStore } from "~/lib/state/mcpTools";
import { useShallowThemeStore } from "~/lib/state/theme";
import { AppCardDropdown } from "./AppCardDropdown";
import { PopoverContent } from "./PopoverContent";
import { SharedWithPopover } from "./SharedWithPopover";
import { Tag } from "./Tag";
import type { AppCardDropdownItem, AppCardProps } from "./types";

const AppCard = memo<AppCardProps>((props) => {
  const {
    template,
    setDeleteConfirm,
    bottomLeft,
    bottomRight,
    className,
    hideActions,
  } = props;

  const { theme, setEditAppDialog, setShareUserAppsPopupId } = useShallowThemeStore(
    (state) => ({
      theme: state.theme,
      setEditAppDialog: state.setEditAppDialog,
      setShareUserAppsPopupId: state.setShareUserAppsPopupId,
    }),
  );
  const mayShare = useShallowAccessStore((state) => canShare(state.access));
  const mayAddConnections = useShallowAccessStore((state) =>
    canAddConnections(state.access),
  );
  const navigate = useNavigate();

  const { source, refreshApiSourceById } = useShallowBackendConnectorStore((state) => ({
    source: template.source?.id ? state.getApiSourceById(template.source.id) : null,
    refreshApiSourceById: state.refreshApiSourceById,
  }));

  const customSourceId = source?.id;

  const { mcpServerEntry, mcpToolCount } = useShallowMcpToolsStore((s) => {
    if (!customSourceId) return { mcpServerEntry: undefined, mcpToolCount: 0 };
    const server = s.servers.find((x) => x.sourceId === customSourceId);
    if (!server) return { mcpServerEntry: undefined, mcpToolCount: 0 };
    const conn = s.getMCPConnection(server.id);
    const ready = conn?.state === "ready";
    return {
      mcpServerEntry: server,
      mcpToolCount: ready ? (conn?.tools?.length ?? 0) : 0,
    };
  });

  const mcpServer = template.mcpServers?.[0]
    ? template.mcpServers[0]
    : mcpServerEntry
      ? {
          name: mcpServerEntry.name,
          url: mcpServerEntry.url,
          description: undefined as string | undefined,
          authType: mcpServerEntry.authType,
        }
      : undefined;

  const uniqueId = useId();
  const descriptionRef = useRef<HTMLDivElement>(null);

  const [state, dispatch] = useStateReducer({
    isDescriptionTruncated: false,
    isRefreshing: false,
  });
  const isBackendLoading = source?.status === "pending" || state.isRefreshing;

  useEffect(() => {
    const checkIfTruncated = () => {
      if (descriptionRef.current) {
        const { scrollHeight, clientHeight } = descriptionRef.current;
        dispatch({ isDescriptionTruncated: scrollHeight > clientHeight });
      }
    };

    checkIfTruncated();
    window.addEventListener("resize", checkIfTruncated);
    return () => window.removeEventListener("resize", checkIfTruncated);
  }, [template.description]);

  const imgSrc = useMemo(() => {
    return template[`img_${theme}`] || template.img;
  }, [theme, template.img_dark, template.img_light, template.img]);

  const handleRefreshBackend = useCallback(
    async (e: ReactMouseEvent) => {
      e.stopPropagation();
      if (!template.source?.id || isBackendLoading) return;

      dispatch({ isRefreshing: true });
      try {
        await refreshApiSourceById(template.source.id);
      } finally {
        dispatch({ isRefreshing: false });
      }
    },
    [template.source?.id, isBackendLoading, dispatch, refreshApiSourceById],
  );

  const widgetTooltipItems = useMemo(() => {
    if (!(template.widgets && template.widgets.length > 0)) return [];

    return template.widgets.map((widget) => {
      const w = widget as {
        id?: string;
        name?: string;
        description?: string | null;
        count?: number;
      };
      const name = w.name || "Unknown Widget";
      const displayName = `${name}${(w.count ?? 0) > 1 ? ` (${w.count})` : ""}`;
      return (
        <WidgetTooltipItem
          key={name}
          name={name}
          displayName={displayName}
          description={w.description}
          origin={template.source?.name}
          widgetId={w.id}
        />
      );
    });
  }, [template.widgets, template.source?.name]);

  const descriptionElement = useMemo(
    () => (
      <div
        ref={descriptionRef}
        className="text-xs text-ds-text-body line-clamp-3 min-h-12"
      >
        {template.description}
      </div>
    ),
    [template.description, descriptionRef],
  );

  const isBackendApp = template.source?.id && template.type !== "generated";
  const isPersonalApp = template.type === "generated";

  const tagElement = useMemo(() => {
    if (template.type === "generated") return <Tag name="Saved App" />;

    const tagName = template.source?.name;
    if (tagName) return <Tag name={tagName} />;

    return null;
  }, [template.type, template.source?.name]);

  const dropDownItems = useMemo<AppCardDropdownItem[]>(() => {
    if (template.type === "shared" || !(isBackendApp || isPersonalApp)) return [];

    const elements: AppCardDropdownItem[] = [
      {
        label: `Delete${isBackendApp ? " Backend" : ""}`,
        onClick: () =>
          setDeleteConfirm?.({ template, type: isBackendApp ? "backend" : "app" }),
        color: "#E03C3C",
      },
    ];

    if (template.creator && isPersonalApp) {
      elements.unshift({
        label: "Edit",
        onClick: () =>
          setEditAppDialog({
            isOpen: true,
            appId: template.id,
            data: {
              name: template.name,
              description: template.description,
              img: template.img,
              prompts: template.prompts,
            },
          }),
      });
    }

    // Backends the user connected themselves (type "user") map 1:1 to a row on
    // the Connections page; link there and highlight it. Excludes shared/listed
    // backends, whose connection row id wouldn't match this source id.
    const connectionId = template.source?.id;
    if (template.type === "user" && connectionId && mayAddConnections) {
      elements.unshift({
        label: "Go to connection",
        onClick: () => navigate(`/app/connections?connectionId=${connectionId}`),
      });
    }

    return elements;
  }, [
    isBackendApp,
    isPersonalApp,
    setDeleteConfirm,
    template,
    navigate,
    mayAddConnections,
  ]);

  const bottomItems = useMemo<ReactNode[]>(() => {
    const createdByInitials = template.createdBy
      ? getUserInitials(template.createdBy)
      : "";
    const items: ReactNode[] = [];

    if (template.widgets && template.widgets.length > 0) {
      items.push(
        <HoverPopover
          key="widgets"
          contentClassName=""
          id={`template-widgets-${uniqueId}`}
          side="top"
          triggerClassName="flex items-center gap-1"
          trigger={
            <>
              <Icon id="layout-top" className="size-3.5 text-ds-text-body" />
              <span className="text-2xs text-link-color">
                {template?.totalWidgets || template.widgets.length}
              </span>
            </>
          }
          content={
            <PopoverContent
              id={`template-widgets-${uniqueId}`}
              title="Widgets"
              items={widgetTooltipItems}
              totalItems={template?.totalWidgets || template.widgets.length}
            />
          }
        />,
      );
    }

    if (template.prompts.length > 0) {
      items.push(
        <HoverPopover
          key="prompts"
          contentClassName=""
          id={`template-prompts-${uniqueId}`}
          side="top"
          onClick={(e) => e.stopPropagation()}
          triggerClassName="flex items-center gap-1"
          trigger={
            <>
              <Icon
                id="message-text-square-02"
                className="size-3.5 text-ds-text-body"
              />
              <span className="text-2xs text-link-color">
                {template.prompts.length}
              </span>
            </>
          }
          content={
            <PopoverContent
              id={`template-prompts-${uniqueId}`}
              title="Prompts"
              items={template.prompts}
            />
          }
        />,
      );
    }

    if (mcpServer && customSourceId) {
      const displayCount = mcpToolCount > 0 ? mcpToolCount : 1;
      items.push(
        <HoverPopover
          key="mcp"
          contentClassName="bg-general-bg-primary p-2.5"
          id={`template-mcp-${uniqueId}`}
          side="top"
          onClick={(e) => e.stopPropagation()}
          triggerClassName="flex items-center gap-1"
          trigger={
            <>
              <Icon id="mcp" className="size-3.5 text-ds-text-body" />
              <span className="text-2xs text-link-color">{displayCount}</span>
            </>
          }
          content={
            <McpAppPopover
              sourceId={customSourceId}
              mcpServer={mcpServer}
              isSubscribed={true}
            />
          }
        />,
      );
    }

    if (!template.creator && (template.type === "shared" || template.isShared)) {
      items.push(
        <HoverPopover
          key="shared"
          contentClassName=""
          id={`shared-${uniqueId}`}
          side="top"
          onClick={(e) => e.stopPropagation()}
          triggerClassName="flex items-center gap-1"
          trigger={
            <>
              <Icon id="user-icon" className="size-3.5 text-ds-text-body" />
              {createdByInitials && (
                <span className="text-2xs text-alert-warning font-medium uppercase">
                  {createdByInitials}
                </span>
              )}
            </>
          }
          content={
            <PopoverContent
              id={`shared-${uniqueId}`}
              title="You have access to this app"
            >
              {template.createdBy && (
                <div className="text-ds-text-caption">
                  Owner:{" "}
                  <span className="text-alert-warning">{template.createdBy}</span>
                </div>
              )}
            </PopoverContent>
          }
        />,
      );
    }

    if (
      template.type === "generated" &&
      template.creator &&
      template.sharedWith &&
      template.sharedWith.length > 0
    ) {
      items.push(
        <SharedWithPopover
          key="shared-with"
          sharedUsers={template.sharedWith}
          id={`shared-with-${uniqueId}`}
        />,
      );
    }

    return items;
  }, [
    template,
    uniqueId,
    widgetTooltipItems,
    mcpServer,
    customSourceId,
    mcpToolCount,
    source,
  ]);

  const whiteLabel = getConfig().whiteLabel;

  return (
    <div
      role="button"
      onClick={isBackendLoading ? undefined : template.onClick}
      className={cn(
        `bg-general-bg-primary border border-general-border-secondary
          hover:border-general-border-primary rounded p-2.5 flex flex-col cursor-pointer`,
        className,
        { "opacity-50 cursor-wait": isBackendLoading },
      )}
    >
      <div
        className="flex items-center justify-between cursor-auto!"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-w-0">{tagElement}</div>
        {!hideActions && (
          <div className="flex items-center gap-0.5 shrink-0">
            {dropDownItems.length > 0 && <AppCardDropdown items={dropDownItems} />}
          </div>
        )}
      </div>
      <div className="mt-2.5 w-full rounded overflow-hidden bg-surface-card aspect-[5/3] border border-general-border-secondary">
        <AuthenticatedAvatar
          src={imgSrc}
          source={template.source}
          alt={template.name}
          className="w-full h-full object-cover text-ds-text-body text-center text-2xs"
          fallback={
            <div className="w-full h-full flex items-center justify-center">
              {whiteLabel.leftSidebarLogo ? (
                <img
                  className="w-[100px] object-contain opacity-50"
                  src={
                    theme === "dark" && whiteLabel.leftSidebarLogoDark
                      ? whiteLabel.leftSidebarLogoDark
                      : whiteLabel.leftSidebarLogo
                  }
                  alt={whiteLabel.name || "Workspace"}
                />
              ) : (
                <Icon
                  id="material-symbols-image-outline"
                  className="w-16 h-12 text-general-label-disabled"
                />
              )}
            </div>
          }
        />
      </div>
      <div className="mt-2.5 flex flex-col gap-2">
        <div className="text-sm font-bold text-ds-text-heading truncate">
          {template.name}
        </div>
        {state.isDescriptionTruncated ? (
          <Tooltip
            message={template.description}
            position="top"
            className="max-w-[300px]"
          >
            {descriptionElement}
          </Tooltip>
        ) : (
          descriptionElement
        )}
      </div>
      <div
        className="flex items-center justify-between gap-2 mt-auto pt-4 cursor-auto!"
        onClick={(e) => e.stopPropagation()}
      >
        {bottomLeft ?? (
          <div className="flex items-center">
            {bottomItems.map((item, i) => (
              <Fragment key={i}>
                {i > 0 && <div className="mx-2 h-3.5 w-px bg-surface-divider" />}
                {item}
              </Fragment>
            ))}
          </div>
        )}
        {bottomRight ?? (
          <div className="flex items-center gap-0.5">
            {mayShare && isPersonalApp && template.onDelete && template.creator && (
              <Tooltip message="Share app" position="top">
                <Button
                  variant="secondary"
                  size="xs"
                  icon
                  onClick={(e) => {
                    e.stopPropagation();
                    setShareUserAppsPopupId(template.id);
                  }}
                >
                  <Icon id="share-07" className="size-3.5 text-ds-text-body" />
                </Button>
              </Tooltip>
            )}
            {isBackendApp && template.type !== "shared" && (
              <Tooltip
                message="Refresh backend associated with this app"
                position="top"
              >
                <Button
                  variant="secondary"
                  size="xs"
                  icon
                  loading={isBackendLoading}
                  disabled={isBackendLoading}
                  onClick={handleRefreshBackend}
                  loadingChildren={null}
                >
                  <Icon
                    id="refresh-icon-ds"
                    className={cn("size-3.5 text-ds-text-body", {
                      "animate-spin": isBackendLoading,
                    })}
                  />
                </Button>
              </Tooltip>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

export default AppCard;
