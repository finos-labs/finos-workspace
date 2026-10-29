import { useCallback, useMemo } from "react";
import type { Group, GroupTypeT, ParamDef, StoredParamValue } from "~/components/types";
import { useWidgetContext } from "~/components/Widget.context";
import { useShallowAppStore } from "~/lib/state/app";
import { useShallowSharedAppStore } from "~/lib/state/sharedApp";
import { getEndpointParamName } from "~/lib/utils";

export type ParamGroupBinding = [string, GroupTypeT<"endpointParam" | "param">];

const EMPTY_GROUPS: Group[] = [];

export function getGroupParamName(group: Group, paramDefs: ParamDef[]): string {
  if (group.type === "endpointParam") {
    return getEndpointParamName(paramDefs, group.groupById) ?? group.groupById;
  }
  return group.groupById;
}

export function useParamGroupBindings(params?: {
  includeDashboardGroups?: boolean;
  endpointParamsOnly?: boolean;
  filterAllowedParams?: boolean;
}) {
  const {
    includeDashboardGroups = false,
    endpointParamsOnly = false,
    filterAllowedParams = false,
  } = params ?? {};

  const { widgetFromJSON, activeDashboardId, isShared } = useWidgetContext();
  const getDashboardById = useShallowSharedAppStore((s) => s.getDashboardById);

  const { activeWidgetGroups, activeDashboardGroups, updateGroup } = useShallowAppStore(
    (s) => {
      const getTabById = isShared ? getDashboardById : s.getTabById;
      const dashboardGroups = includeDashboardGroups
        ? getTabById(activeDashboardId)?.data?.groups
        : undefined;

      return {
        activeWidgetGroups: s.getWidgetGroups(activeDashboardId, widgetFromJSON?.id),
        activeDashboardGroups: dashboardGroups ?? EMPTY_GROUPS,
        updateGroup: s.updateGroup,
      };
    },
  );

  const allowedParams = useMemo(() => {
    if (!widgetFromJSON?.params) return undefined;
    return new Set(
      widgetFromJSON.params
        .filter((p) => (endpointParamsOnly ? p.type === "endpoint" : true))
        .map((p) => p.paramName)
        .filter(Boolean),
    );
  }, [widgetFromJSON?.params, endpointParamsOnly]);

  const bindings = useMemo<ParamGroupBinding[]>(() => {
    const result: ParamGroupBinding[] = [];
    const seenGroupIds = new Set<string>();

    const addGroupBinding = (group: Group) => {
      if (seenGroupIds.has(group.id)) return;

      const paramName = getGroupParamName(group, widgetFromJSON?.params ?? []);
      if (!paramName) return;
      if (filterAllowedParams && allowedParams && !allowedParams.has(paramName)) return;

      seenGroupIds.add(group.id);
      result.push([paramName, group]);
    };

    for (const group of activeWidgetGroups) addGroupBinding(group);
    for (const group of activeDashboardGroups) addGroupBinding(group);

    return result;
  }, [
    activeWidgetGroups,
    activeDashboardGroups,
    widgetFromJSON?.params,
    allowedParams,
    filterAllowedParams,
  ]);

  const updateGroupedParam = useCallback(
    (paramName: string, value: StoredParamValue) => {
      const group = bindings.find(([name]) => name === paramName)?.[1];
      if (!group?.id) return false;

      updateGroup(activeDashboardId, group.id, { ...group, value } as Group);
      return true;
    },
    [activeDashboardId, bindings, updateGroup],
  );

  const updateGroupedParams = useCallback(
    (params: Record<string, StoredParamValue>) => {
      for (const [paramName, group] of bindings) {
        if (!Object.prototype.hasOwnProperty.call(params, paramName)) continue;

        const value = params[paramName];
        if (group.value === value) continue;

        updateGroup(activeDashboardId, group.id, { ...group, value } as Group);
      }
    },
    [activeDashboardId, bindings, updateGroup],
  );

  return useMemo(
    () => ({ bindings, updateGroupedParam, updateGroupedParams }),
    [bindings, updateGroupedParam, updateGroupedParams],
  );
}
