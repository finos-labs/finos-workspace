import { create } from "zustand";
import { persist } from "zustand/middleware";

import {
  BackendId,
  BackendsMap,
  WidgetDefinition,
  WidgetId,
} from "~/types/widget.types";

export interface CustomBackendsStore {
  backendsMap: BackendsMap;
  widgetNameToIdByBackendIdMap: Record<BackendId, Record<string, WidgetId>>;
  update: (newMap: BackendsMap) => void;
  getBackendWidgets: (
    backendId: string,
  ) => Record<WidgetId, WidgetDefinition> | undefined;
  getWidgetIdFromName: (
    backendId: string,
    widgetName: string,
  ) => WidgetId | undefined;
}

export const useCustomBackendsStore = create<CustomBackendsStore>()(
  persist(
    (set, get) => ({
      backendsMap: {},
      widgetNameToIdByBackendIdMap: {},
      update(newMap) {
        set((state) => {
          const updatedBackendsMap = {
            ...(state.backendsMap ?? {}),
            ...newMap,
          };

          // Update the widgetNameToIdByBackendIdMap
          const updatedWidgetNameToIdMap: Record<
            BackendId,
            Record<string, WidgetId>
          > = {};
          Object.entries(updatedBackendsMap).forEach(([backendId, widgets]) => {
            updatedWidgetNameToIdMap[backendId] = {};
            Object.entries(widgets).forEach(([widgetId, widget]) => {
              updatedWidgetNameToIdMap[backendId][widget.name] = widgetId;
            });
          });

          return {
            backendsMap: updatedBackendsMap,
            widgetNameToIdByBackendIdMap: updatedWidgetNameToIdMap,
          };
        });
      },
      getBackendWidgets(backendId: string) {
        const { backendsMap } = get();
        return backendsMap[backendId];
      },
      getWidgetIdFromName(backendId: string, widgetName: string) {
        const { widgetNameToIdByBackendIdMap } = get();
        return widgetNameToIdByBackendIdMap[backendId]?.[widgetName];
      },
    }),
    {
      name: "custom-backends",
    },
  ),
);
