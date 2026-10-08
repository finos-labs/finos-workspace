import isEqual from "lodash.isequal";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useIsFirstRender } from "~/hooks/useIsFirstRender";
import { useCallbackRef, useCreateRef } from "~/hooks/useRefHooks";
import { useTabContext } from "~/lib/contexts/TabContext";
import {
  type AppState,
  type Group,
  useAppStore,
  useShallowAppStore,
} from "~/lib/state/app";
import { type SharedAppState, useSharedAppStore } from "~/lib/state/sharedApp";
import {
  addToWidgetParamGroups,
  getEndpointParamGroupByIds,
  getEndpointParamName,
  getJsonWidget,
  getWidgetInfo,
  needsGroupValueUpdate,
  triggerCustomEvent,
  updateWidgetGroupValues,
  useEventListener,
} from "~/lib/utils";
import type { NewWidgetT, StoredParamValue, WidgetProps, WidgetT } from "./types";

type SubType = [Group[], string | null | undefined];

/** The subscription both app stores, of a user's dashboards and of a shared one, give to watch a widget. */
type SubscribeToWidgetState = <U>(
  selector: (state: SharedAppState | AppState) => U,
  listener: (current: U, previous: U) => void,
  options: { fireImmediately: boolean },
) => () => void;

/**
 * Decides whether an in-memory widget update must also be persisted to the
 * app store. Param-group, group, and ticker changes are the historical
 * triggers; everything else stays in provider state until an explicit save.
 * Extracted from updateWidgetCallback so the gate is testable in isolation.
 */
export function shouldPersistWidgetUpdate(
  currentWidget: WidgetT,
  newWidget: WidgetT,
  getParamName: (groupById: string) => string,
): boolean {
  const prevMainTicker = currentWidget.data?.mainTicker?.symbol;
  const prevParams = currentWidget.storage?.params;
  const prevGroupById = currentWidget.groupById;
  const newMainTicker = newWidget.data?.mainTicker?.symbol;
  const newParams = newWidget.storage?.params;

  // Identity fields set by update_widget (MCP/copilot) arrive without any
  // param/group change — they must persist or the rename is a silent no-op.
  // The `in` guard keeps partial update objects from forcing store churn.
  if (
    ("name" in newWidget && currentWidget.name !== newWidget.name) ||
    ("description" in newWidget &&
      currentWidget.description !== newWidget.description) ||
    ("source" in newWidget && currentWidget.source !== newWidget.source)
  ) {
    return true;
  }

  if (newWidget.paramGroups) {
    const paramNames = Object.keys(newWidget.paramGroups);

    if (
      paramNames.some((groupById) => {
        const paramName = getParamName(groupById);

        return newParams?.[paramName] !== prevParams?.[paramName];
      })
    ) {
      return true;
    }
  }

  if (prevGroupById || newWidget.groupId) {
    const paramName = getEndpointParamName(newWidget.params ?? [], newWidget.groupById);
    if (
      prevGroupById !== newWidget.groupId ||
      prevMainTicker !== newMainTicker ||
      (paramName && prevParams?.[paramName] !== newParams?.[paramName])
    ) {
      return true;
    }
  }

  return false;
}

export function useWidgetSync(props: Omit<WidgetProps, "children">) {
  const { getWidget, isShared } = useTabContext();
  const [providerWidget, setProviderWidget] = useState(
    props.contextOverride?.widget || (getWidget?.(props.uuid ?? "") as WidgetT),
  );

  const isFirstRender = useIsFirstRender();

  const storeUpdateWidget = useShallowAppStore((state) => state.updateWidget);

  const widgetFromJSON = useMemo(
    () => getJsonWidget(providerWidget),
    [providerWidget?.widgetId, getWidgetInfo(providerWidget), providerWidget?.params],
  );

  useEffect(() => {
    if (isFirstRender) return;
    if (props.isPreview && props.contextOverride?.widget) {
      setProviderWidget(props.contextOverride.widget);
    }
  }, [props.contextOverride?.widget]);

  const endpointParams = useMemo(() => {
    return getEndpointParamGroupByIds(providerWidget);
  }, [providerWidget?.params]);

  const getParamName = useCallbackRef(
    (groupById: string) => endpointParams?.[groupById] ?? groupById,
  );

  const needsUpdateRef = useRef(false);

  // Use a ref to keep track of the current providerWidget
  const providerWidgetRef = useCreateRef(providerWidget);

  // Use a ref to keep track of the saveToStore callback
  const saveToStoreCb = useCallbackRef(() => {
    if (needsUpdateRef.current && !props.contextOverride) {
      if (props.activeDashboardId)
        storeUpdateWidget(props.activeDashboardId, providerWidget);
      needsUpdateRef.current = false;
    }
  });

  const onBeforeUnload = useCallback(
    (_e: BeforeUnloadEvent) => {
      if (needsUpdateRef.current) saveToStoreCb();
    },
    [saveToStoreCb, needsUpdateRef],
  );

  useEffect(() => {
    const { activeDashboardId, uuid, contextOverride } = props;
    let unsubscribe: (() => void) | null = null;
    const ctrl = new AbortController();

    if (providerWidget?.external && providerWidget?.staleTime === undefined) {
      setProviderWidget((currentWidget) => {
        return { ...currentWidget, staleTime: 1000 * 60 * 15 };
      });
    }

    if (!contextOverride && activeDashboardId && uuid) {
      const subscribe: SubscribeToWidgetState = isShared
        ? (selector, listener, options) =>
            useSharedAppStore.subscribe(selector, listener, options)
        : (selector, listener, options) =>
            useAppStore.subscribe(selector, listener, options);
      unsubscribe = subscribe(
        (s: SharedAppState | AppState): SubType => {
          const storeWidget = s.getWidgetById(uuid);
          return [s.getWidgetGroups(activeDashboardId, uuid), storeWidget?.innerTab];
        },
        (current, prev) => {
          const lastWidget = providerWidgetRef.current;

          const [groups, innerTab] = current;
          const [prevGroups] = prev;
          const group = groups?.find((g) => g.type === "ticker");

          const newGroup =
            !isEqual(groups, prevGroups) || lastWidget?.groupId !== group?.id;

          const linkedGroups = groups?.filter((g) =>
            needsGroupValueUpdate(lastWidget, g),
          );
          const groupValuesUpdated = linkedGroups?.length > 0;

          if (newGroup || groupValuesUpdated) {
            return setProviderWidget((currentWidget) => {
              const updatedWidget = updateWidgetGroupValues(
                currentWidget,
                linkedGroups,
              );
              updatedWidget.groupId = group?.id ?? null;
              updatedWidget.paramGroups = (groups || []).reduce<Record<string, string>>(
                (acc, g) => {
                  if (g.type === "ticker") return acc;
                  return addToWidgetParamGroups(acc, g);
                },
                {},
              );

              const groupParams = Object.keys(updatedWidget.paramGroups);
              const updatedParams = groupParams.reduce<
                Record<string, StoredParamValue>
              >((acc, groupById) => {
                const paramName = getParamName(groupById);
                const value = updatedWidget.storage?.params?.[paramName];
                if (value !== undefined) acc[paramName] = value;
                return acc;
              }, {});

              if (groupValuesUpdated && groupParams?.length > 0) {
                triggerCustomEvent(`updateQueryParams-${uuid}`, updatedParams);
              }

              return updatedWidget;
            });
          }

          if (lastWidget?.innerTab !== innerTab)
            setProviderWidget((currentWidget) => ({
              ...currentWidget,
              innerTab: innerTab ?? undefined,
            }));
        },
        { fireImmediately: true },
      );
    }

    // Add event listeners for beforeunload and save shortcut
    window.addEventListener("beforeunload", onBeforeUnload, { signal: ctrl.signal });

    return () => {
      if (unsubscribe) {
        unsubscribe();
        saveToStoreCb();
      }
      ctrl.abort();
    };
  }, [
    providerWidgetRef,
    needsUpdateRef,
    getParamName,
    saveToStoreCb,
    setProviderWidget,
  ]);

  const updateWidgetCallback = useCallback(
    (newWidget: NewWidgetT, forceStoreUpdate = false) => {
      if (!newWidget) return;

      setProviderWidget((currentWidget) => {
        if (typeof newWidget === "function") newWidget = newWidget(currentWidget);

        if (!props.contextOverride) {
          if (!needsUpdateRef.current)
            needsUpdateRef.current = !isEqual(currentWidget, newWidget);

          const updateStore =
            forceStoreUpdate ||
            shouldPersistWidgetUpdate(
              currentWidget,
              newWidget as WidgetT,
              getParamName,
            );

          if (updateStore) {
            queueMicrotask(() => {
              if (props.activeDashboardId)
                storeUpdateWidget(props.activeDashboardId, newWidget as WidgetT);
            });
          }
        }
        props.contextOverride?.updateWidget?.(newWidget);

        return newWidget;
      });
    },
    [
      needsUpdateRef,
      setProviderWidget,
      props.contextOverride?.updateWidget,
      props.activeDashboardId,
      getParamName,
    ],
  );

  useEventListener("saveWidgets", saveToStoreCb);
  useEventListener("refreshQuery", () =>
    setProviderWidget((currentWidget) => ({
      ...currentWidget,
      refreshQuery: Date.now(),
    })),
  );
  useEventListener(`updateWidget-${props?.uuid}`, updateWidgetCallback);

  return [updateWidgetCallback, providerWidget, widgetFromJSON] as const;
}
