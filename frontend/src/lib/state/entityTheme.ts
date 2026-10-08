import isEqual from "lodash.isequal";
import { toast } from "sonner";
import { subscribeWithSelector } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import { createWithEqualityFn } from "zustand/traditional";
import { shallow } from "zustand/vanilla/shallow";
import { updateEntityThemeSettings } from "~/api/admin.api";
import { getEntityThemeSettings } from "~/api/auth.api";
import type { Selector } from "./app";

// Application-level theming (e.g., grouping colors)
type AppTheme = {
  grouping: {
    palette: string[];
  };
};

export type ThemeSettings = {
  appTheme?: AppTheme | null;
};

export interface EntityThemeSettings {
  light: ThemeSettings | null;
  dark: ThemeSettings | null;
}

interface EntityThemeState extends EntityThemeSettings {
  updateThemeSettings: (settings?: EntityThemeSettings) => Promise<void>;
  saveThemeSettings: (settings: EntityThemeSettings) => Promise<void>;
}

const getDefault = (): ThemeSettings => ({
  appTheme: null,
});

export const useEntityThemeStore = createWithEqualityFn<EntityThemeState>()(
  subscribeWithSelector((set, _get) => ({
    light: getDefault(),
    dark: getDefault(),
    updateThemeSettings: async (settings) => {
      if (settings) return set(settings);

      settings = await getEntityThemeSettings();
      for (const mode of ["light", "dark"] as const) {
        if (settings[mode] === null) {
          settings[mode] = getDefault();
        }
      }
      set(settings);
    },
    saveThemeSettings: async (settings) => {
      const changedSettings = await getEntityThemeSettings();

      for (const mode of ["light", "dark"] as const) {
        if (!settings[mode]) continue;

        if ("appTheme" in settings[mode])
          changedSettings[mode] = {
            ...changedSettings[mode],
            appTheme: settings[mode]?.appTheme,
          };
      }
      set(changedSettings);
      await updateEntityThemeSettings(changedSettings);

      toast.success("Theme settings updated.", {
        id: "theme-settings-update",
        description: "Grouping theme settings updated.",
      });
    },
  })),
  shallow,
);

export function useShallowEntityThemeStore<T>(
  selector: Selector<EntityThemeState, T>,
): T {
  return useEntityThemeStore(useShallow(selector), (prev, next) => isEqual(prev, next));
}
