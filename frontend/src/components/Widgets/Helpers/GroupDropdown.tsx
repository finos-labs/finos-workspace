import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { debounce } from "lodash";
import {
  type CSSProperties,
  createContext,
  Fragment,
  forwardRef,
  memo,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Icon from "~/components/Icon";
import Tooltip from "~/components/SpecialTooltip";
import type { Group, GroupTypes, ParamDef, Widget } from "~/components/types";
import { useWidgetContext } from "~/components/Widget.context";
import { useStateReducer } from "~/hooks/useStateReducer";
import {
  type TabEndpointParams,
  type TabParams,
  useAppStore,
  useShallowAppStore,
} from "~/lib/state/app";
import { useEntityThemeStore } from "~/lib/state/entityTheme";
import { useShallowSharedAppStore } from "~/lib/state/sharedApp";
import { useShallowThemeStore, useThemeStore } from "~/lib/state/theme";
import {
  COLORS,
  cn,
  getEndpointParamName,
  getEndpointParams,
  getGroupInfo,
  getGroupKindLabel,
  getGroupLabel,
  scoreArrays,
  triggerCustomEvent,
  useEventListener,
  uuidv4,
} from "~/lib/utils";
import { NotificationId, showNotificationWithRememberMe } from "~/lib/utils/toast";
import { areTruthy } from "~/lib/utils/values";
import { getContrastTextColor } from "~/utils/colorUtils";
import { GroupPanelHeader, GroupRow } from "./GroupRow";

interface GroupDropdownProps {
  children?: ReactNode;
  type?: GroupTypes;
  groupById?: string;
  paramDef?: ParamDef;
  className?: string;
}

export const GroupDropdownAnchorContext =
  createContext<RefObject<HTMLDivElement | null> | null>(null);

export const GroupDropdown = forwardRef<HTMLButtonElement, GroupDropdownProps>(
  (
    { children, className = "ws-parameter", paramDef, ...rest }: GroupDropdownProps,
    _ref,
  ) => {
    const {
      widget: { id: widgetUuid, paramGroups } = {},
      activeDashboardId,
      widgetFromJSON,
    } = useWidgetContext();

    const params = useMemo(
      () => widgetFromJSON?.params ?? [],
      [widgetFromJSON?.params],
    );

    const props = useMemo(() => {
      const newProps = {
        ...rest,
        paramDef,
        groupById: rest?.groupById || paramDef?.paramName,
      };
      if (paramDef?.type === "endpoint") {
        newProps.groupById = paramDef?.groupById;
      }

      if (!newProps.type && paramDef) {
        newProps.type = paramDef.type === "endpoint" ? "endpointParam" : "param";
      }

      return newProps;
    }, [rest, paramDef]);

    const optionValues = useMemo(() => {
      if (props?.type !== "param") return [];

      if (!paramDef) {
        const paramName = props?.groupById;
        const param = params?.find(
          (param) => param.paramName === paramName && param.type !== "endpoint",
        );
        return param?.options?.map((o) => o.value) || [];
      }

      return paramDef?.options?.map((o) => o.value) || [];
    }, [params, paramDef?.options, paramDef?.type, props?.type, props?.groupById]);

    const [state, dispatch] = useStateReducer({
      canGroup: false,
      group: null as Group | null,
      groupTextColor: getContrastTextColor(""),
    });

    const [show, setShow] = useState(false);

    const groupingVisible = useShallowThemeStore((state) => state.groupingVisible);
    const getDashboardById = useShallowSharedAppStore((s) => s.getDashboardById);

    const updateGroupState = useCallback(
      (params: {
        groups: Group[];
        currentTabParams: TabParams;
        currentEndpointParams: TabEndpointParams;
      }) => {
        const { groups, currentTabParams, currentEndpointParams } = params;
        const paramName = props?.groupById ?? "";

        const group = groups?.find(
          (group) => group.type === props.type && paramGroups?.[paramName] === group.id,
        );

        let canGroup = !!activeDashboardId;
        if (props.type === "param" && canGroup) {
          const tabParam = currentTabParams?.[paramName];
          canGroup = (tabParam?.total ?? 0) > 1 || !!group?.id;

          if (areTruthy(optionValues, tabParam?.options)) {
            const score = scoreArrays(optionValues, tabParam?.options, true)?.score;

            canGroup = (score > 0.5 && (tabParam?.total ?? 0) > 1) || !!group?.id;
          }
        }

        if (props.type === "endpointParam" && canGroup) {
          const tabEndpointParam = currentEndpointParams?.[paramName];
          canGroup = (tabEndpointParam ?? 0) > 1 || !!group?.id;
        }

        const groupTextColor = getContrastTextColor(group?.color ?? "");
        return { canGroup, group, groupTextColor };
      },
      [activeDashboardId, paramGroups, props.type, props?.groupById, optionValues],
    );

    useEffect(() => {
      let unsub = null;

      unsub = useAppStore.subscribe(
        (s) => {
          const tab =
            s.getTabById(activeDashboardId) || getDashboardById(activeDashboardId);
          return {
            groups: tab?.data?.groups || [],
            currentTabParams: s.currentTabParams,
            currentEndpointParams: s.currentEndpointParams,
          };
        },
        (current) => dispatch(updateGroupState(current)),

        { fireImmediately: true },
      );

      return () => unsub?.();
    }, [updateGroupState]);

    const { canGroup, group, groupTextColor } = state;

    const groupFirstLetter = useMemo(() => {
      const parts = group?.name?.split(" ");
      const secondPart = parts?.[1];
      if (Number.isNaN(Number(secondPart))) {
        return parts?.[0]?.charAt(0);
      }
      return secondPart;
    }, [group]);

    const groupParamValueDetails = useMemo(() => {
      const { valueLabel, paramLabel } = getGroupInfo(group, paramDef);

      return (
        <div className="mt-1.5 grid gap-0.5">
          <span className="body-xs-medium break-words dark:text-light-100 text-light-900">
            {paramLabel}
          </span>
          <span className="body-xs-regular break-words dark:text-light-300 text-light-600">
            {valueLabel}
          </span>
        </div>
      );
    }, [group, paramDef?.options, paramDef?.paramName, paramDef?.label]);

    const currentGroupTooltip = useMemo(() => {
      if (!group?.name) return "Group widget";

      return (
        <div className="space-y-1">
          <p className="body-xs-regular dark:text-light-100 text-light-900">
            Current group: {group.name}
          </p>
          {groupParamValueDetails}
        </div>
      );
    }, [group?.name, groupParamValueDetails]);

    const groupContentMemo = useMemo(() => <GroupContent {...props} />, [props]);

    const childrenMemo = useMemo(() => children, [children]);

    const [isHoverSynced, setIsHoverSynced] = useState(false);
    const syncParamName = paramDef?.paramName;

    useEventListener(`sqlParamHover-${widgetUuid}`, (detail) => {
      if (!syncParamName) return;
      setIsHoverSynced(detail?.paramName === syncParamName);
    });

    const hoverSyncProps = useMemo(() => {
      if (!(syncParamName && widgetUuid)) return {};
      const onEvent = (paramName: string | null) =>
        triggerCustomEvent(`sqlParamHoverPill-${widgetUuid}`, { paramName });

      return {
        onMouseEnter: () => onEvent(syncParamName),
        onMouseLeave: () => onEvent(null),
      };
    }, [syncParamName, widgetUuid]);

    const hoverSyncClass = isHoverSynced ? "bg-general-bg-secondary!" : "";

    const anchorRef = useRef<HTMLDivElement | null>(null);

    if (!canGroup)
      return (
        childrenMemo && (
          <div
            className={cn(
              className,
              "flex items-center justify-between gap-1 h-[20px]",
              hoverSyncClass,
            )}
            {...hoverSyncProps}
          >
            {childrenMemo}
          </div>
        )
      );

    if (!groupingVisible && group) {
      const label = getGroupKindLabel(group);
      return (
        <Tooltip
          className="max-w-[265px]"
          message={
            <>
              <p className="body-xs-regular dark:text-light-100 text-light-900">
                This parameter is associated with a group. Changing this will impact the
                group.
              </p>
              <div className="w-fit flex gap-1.5 items-center mt-2 dark:border-dark-400 border border-light-200 rounded p-1">
                <p className="capitalize body-xs-medium dark:text-light-100">{label}</p>
                <span className="inline-flex gap-1 items-center rounded-[2px] dark:bg-dark-500 bg-light-100 py-px px-0.5 body-2xs-regular dark:text-light-300 text-dark-800">
                  <span
                    className="block size-3 rounded-[2px]"
                    style={{ backgroundColor: group.color }}
                  />
                  {group.name}
                </span>
              </div>
              {groupParamValueDetails}
            </>
          }
          delayDuration={100}
          hoverOnly={true}
          preventOnDropdown={true}
        >
          <div
            className={cn(
              className,
              "flex items-center justify-between gap-1 h-[20px] transition-colors duration-200",
              {
                "hover:border-(--group-color)!": group?.color,
              },
              hoverSyncClass,
            )}
            style={
              {
                "--group-color": group?.color,
              } as CSSProperties
            }
            {...hoverSyncProps}
          >
            {childrenMemo}
          </div>
        </Tooltip>
      );
    }

    return (
      <GroupDropdownAnchorContext.Provider value={anchorRef}>
        <div
          ref={anchorRef}
          className={cn(
            className,
            "flex items-center justify-between gap-1 h-[20px]",
            hoverSyncClass,
          )}
          {...hoverSyncProps}
        >
          <DropdownMenu.Root open={show} onOpenChange={setShow} modal={false}>
            <Tooltip className="max-w-[365px]" message={currentGroupTooltip}>
              <DropdownMenu.Trigger asChild={true}>
                <button className="_group-dropdown-trigger w-full h-full flex items-center justify-center">
                  {group?.name ? (
                    <span
                      className={cn(
                        "w-3.5 h-3.5 rounded-[2px] text-2xs flex justify-center items-center font-bold",
                      )}
                      style={{
                        backgroundColor: group.color,
                        color: groupTextColor,
                      }}
                    >
                      {groupFirstLetter}
                    </span>
                  ) : (
                    <Icon id="group-icon" className="w-3.5 h-3.5" />
                  )}
                </button>
              </DropdownMenu.Trigger>
            </Tooltip>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="start"
                sideOffset={5}
                onInteractOutside={(e) => {
                  if ((e.target as HTMLElement)?.closest?.('[data-slot="popover"]')) {
                    e.preventDefault();
                  }
                }}
                style={{
                  boxShadow: "0px 4px 8px 0px rgba(0, 0, 0, 0.25)",
                }}
                className={cn(
                  "ws-dropdown-container",
                  "flex flex-col gap-2 p-2",
                  "text-xs",
                  "z-50 min-w-[183px]",
                )}
              >
                {groupContentMemo}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          {childrenMemo}
        </div>
      </GroupDropdownAnchorContext.Provider>
    );
  },
);

export default memo(GroupDropdown);

function GroupContent(props: Omit<GroupDropdownProps, "children">) {
  const { type, groupById, paramDef } = props;

  const { widget, activeDashboardId } = useWidgetContext();

  const getDashboardById = useShallowSharedAppStore((s) => s.getDashboardById);

  const { addGroup, updateGroup, setWidgetGroupId, groups } = useShallowAppStore(
    (s) => {
      const tab =
        s.getTabById(activeDashboardId) || getDashboardById(activeDashboardId);

      return {
        addGroup: s.addGroup,
        updateGroup: s.updateGroup,
        setWidgetGroupId: s.setWidgetGroupId,
        groups: tab?.data?.groups || [],
      };
    },
  );

  const validGroups = groups.filter((group) => {
    if (type === "param")
      return group.type === "param" && group.groupById === groupById;

    if (type === "endpointParam")
      return (
        group.type === type &&
        paramDef?.type === "endpoint" &&
        group?.groupById === paramDef?.groupById
      );
    return group.type === type;
  });

  const debouncedUpdateGroup = useCallback(debounce(updateGroup, 500), [updateGroup]);

  const groupElements = useMemo(
    () =>
      validGroups.map((element) => (
        <GroupContentItem
          key={element.id}
          element={element}
          updateGroup={debouncedUpdateGroup}
        />
      )),
    [validGroups, debouncedUpdateGroup],
  );

  const onClick = useCallback(() => {
    const newGroup = getNewGroup(widget, groups, type, groupById);

    addGroup(activeDashboardId, newGroup);
    setWidgetGroupId(activeDashboardId, widget?.id, newGroup);
  }, [widget, groups, type, groupById]);

  return (
    <div className="flex flex-col gap-2 group-dropdown">
      <GroupPanelHeader onCreate={onClick} />
      <div className="py-1 space-y-3">
        {validGroups.length === 0 ? (
          <p className="text-ds-text-caption text-xs group-dropdown">
            No Active Groups
          </p>
        ) : (
          groupElements
        )}
      </div>
    </div>
  );
}

const GroupContentItem = memo(
  (props: {
    element: Group;
    updateGroup: (tabId: string, groupId: string, group: Group) => void;
  }) => {
    const { element, updateGroup } = props;

    const { widget: { paramGroups, id: widgetUUid } = {}, activeDashboardId } =
      useWidgetContext();
    const groupedInfo = useMemo(
      () => ({
        groupedValue: getGroupLabel(element),
        selected: Object.values(paramGroups || {}).includes(element.id),
      }),
      [element, paramGroups],
    );

    const { setWidgetGroupId, deleteGroup } = useShallowAppStore((state) => ({
      setWidgetGroupId: state.setWidgetGroupId,
      deleteGroup: state.deleteGroup,
    }));

    const onCheckboxClick = useCallback(
      (e: ReactMouseEvent) => {
        e.stopPropagation();
        e.preventDefault();

        if (!(activeDashboardId && widgetUUid)) return;

        if (groupedInfo.selected) {
          return setWidgetGroupId(activeDashboardId, widgetUUid, element, true);
        }

        setWidgetGroupId(activeDashboardId, widgetUUid, element);
      },
      [groupedInfo, element, widgetUUid, activeDashboardId],
    );

    const onDeleteGroupClick = useCallback(() => {
      const widgetsInGroup = useAppStore
        .getState()
        .getTabById(activeDashboardId)
        ?.data?.widgets.filter((w) =>
          Object.values(w.paramGroups || {}).includes(element.id),
        );

      if ((widgetsInGroup?.length ?? 0) > 0) {
        return showNotificationWithRememberMe({
          id: NotificationId.GroupNotEmpty,
          message: "Group not empty",
          description:
            "There are one or more widgets associated with this group. By deleting this group all widgets within this group will become unlinked. Do you wish to proceed?",
          toastType: "error",
          cancel: {
            label: "Cancel",
            onClick: () => {},
          },
          action: {
            label: "Yes, delete",
            onClick: () => deleteGroup(activeDashboardId, element.id),
          },
        });
      }

      deleteGroup(activeDashboardId, element.id);
    }, [activeDashboardId, deleteGroup, element.id]);

    const onColorChange = useCallback(
      (newColor: string) => {
        updateGroup(activeDashboardId, element.id, {
          ...element,
          color: newColor,
        });
      },
      [element, activeDashboardId, updateGroup],
    );

    const content = useMemo(
      () => (
        <GroupRow
          name={element.name}
          color={element.color}
          valueLabel={groupedInfo?.groupedValue}
          valueTooltip={groupedInfo?.groupedValue}
          selectable={true}
          selected={groupedInfo?.selected}
          onToggleSelect={onCheckboxClick}
          onColorChange={onColorChange}
          onDelete={onDeleteGroupClick}
        />
      ),
      [
        element.name,
        element.color,
        groupedInfo?.groupedValue,
        groupedInfo?.selected,
        onCheckboxClick,
        onColorChange,
        onDeleteGroupClick,
      ],
    );

    return <Fragment key={element.id}>{content}</Fragment>;
  },
);

export function getNewGroup(
  widget: Widget,
  groups: Group[],
  type?: GroupTypes,
  groupById?: string,
): Group {
  const baseGroupName = "Group ";
  let newGroupName = baseGroupName + (groups.length + 1);
  let groupNameSuffix = groups.length;

  while (groups.some((group) => group.name === newGroupName)) {
    groupNameSuffix++;
    newGroupName = baseGroupName + groupNameSuffix;
  }

  const currentTheme = useThemeStore.getState().theme;
  const themeStore = useEntityThemeStore.getState();
  const palette = themeStore[currentTheme]?.appTheme?.grouping?.palette || COLORS;

  const existingColors = groups.map((group) => group.color);
  let color: string;

  if (existingColors.length >= palette.length) {
    color = palette[Math.floor(Math.random() * palette.length)];
  } else {
    const availableColors = palette.filter((c) => !existingColors.includes(c));
    if (availableColors.length > 0) {
      color = availableColors[0];
    } else {
      color = palette[Math.floor(Math.random() * palette.length)];
    }
  }
  const newGroup = { id: uuidv4(), name: newGroupName, color };

  if (type === "endpointParam") {
    const paramName = getEndpointParamName(getEndpointParams(widget), groupById);
    return {
      ...newGroup,
      type: "endpointParam",
      groupById,
      value: (paramName ? widget?.storage?.params?.[paramName] : undefined) ?? null,
    } as Group;
  }

  return {
    ...newGroup,
    type: "param",
    groupById,
    value: (groupById ? widget?.storage?.params?.[groupById] : undefined) ?? null,
  } as Group;
}
