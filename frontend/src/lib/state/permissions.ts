import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import type { PermissionsT } from "~/api/user_roles.api";
import type { Selector } from "./app";

interface PermissionsState {
  permissions: PermissionsT;
  setPermissions: (permissions: PermissionsT) => void;
  hasAccess: (sourceId: string, widgetId: string) => boolean;
  isSharedWidget: (sourceId: string, widgetId: string) => boolean;
}

export const usePermissionsStore = create<PermissionsState>()(
  subscribeWithSelector((set, get) => ({
    permissions: {
      backends: [],
      files: [],
      prompts: [],
    },
    setPermissions: (permissions) => set({ permissions }),
    hasAccess: (sourceId, widgetId) => {
      const permissions = get().permissions;
      if (sourceId) {
        const backend = permissions.backends.find(
          (backend) => backend.uuid === sourceId,
        );
        if (backend) {
          const widget = backend.widgets.find((widget) => widget.widgetId === widgetId);
          if (widget) {
            return widget.access === "access";
          }
          return false;
        }
        const file = permissions.files.find((file) => file.uuid === sourceId);
        if (file) {
          return file.access === "access";
        }
      }

      return false;
    },
    isSharedWidget: (sourceId, widgetId) => {
      const permissions = get().permissions;
      const backend = permissions.backends.find((backend) => backend.uuid === sourceId);
      if (backend) {
        const widget = backend.widgets.find((widget) => widget.widgetId === widgetId);
        return widget?.access === "access";
      }
      const file = permissions.files.find((file) => file.uuid === sourceId);
      if (file) {
        return file.access === "access";
      }

      return false;
    },
  })),
);

export function useShallowPermissionsStore<T>(
  selector: Selector<PermissionsState, T>,
): T {
  return usePermissionsStore(useShallow(selector));
}
