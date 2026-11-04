import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type EntityThemeSettings,
  type ThemeSettings,
  useEntityThemeStore,
} from "~/lib/state/entityTheme";

vi.mock("~/api/admin.api", () => ({
  updateEntityThemeSettings: vi.fn().mockResolvedValue({}),
}));

vi.mock("~/api/auth.api", () => ({
  getEntityThemeSettings: vi.fn().mockResolvedValue({
    light: null,
    dark: null,
  }),
}));

vi.mock("~/lib/theme/sheet", () => ({
  applySavedTheme: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { toast } from "sonner";
import { updateEntityThemeSettings } from "~/api/admin.api";
import { getEntityThemeSettings } from "~/api/auth.api";
import { applySavedTheme } from "~/lib/theme/sheet";
import { partial } from "../../mocks";

const createMockAppTheme = () => ({
  grouping: {
    palette: ["#ff0000", "#00ff00", "#0000ff", "#ffff00"],
  },
});

const createMockThemeSettings = (
  overrides: Partial<ThemeSettings> = {},
): ThemeSettings => {
  return overrides as ThemeSettings;
};

describe("useEntityThemeStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    act(() => {
      useEntityThemeStore.setState({
        light: { appTheme: null },
        dark: { appTheme: null },
      });
    });
  });

  describe("initial state", () => {
    it("should have correct default values for light theme", () => {
      expect(useEntityThemeStore.getState().light).toEqual({ appTheme: null });
    });

    it("should have correct default values for dark theme", () => {
      expect(useEntityThemeStore.getState().dark).toEqual({ appTheme: null });
    });
  });

  describe("updateThemeSettings", () => {
    it("applies the properties of the applied preset", async () => {
      const properties = { light: { "--color-main-100": "#7b2d8e" }, dark: {} };

      await act(async () => {
        await useEntityThemeStore
          .getState()
          .updateThemeSettings({ light: null, dark: null, properties });
      });

      expect(applySavedTheme).toHaveBeenCalledWith(properties);
    });

    it("clears the applied theme when no preset applies", async () => {
      await act(async () => {
        await useEntityThemeStore
          .getState()
          .updateThemeSettings({ light: null, dark: null });
      });

      expect(applySavedTheme).toHaveBeenCalledWith(null);
    });

    it("applies the properties it fetches", async () => {
      const properties = { light: {}, dark: { "--link-color": "#00ff00" } };
      vi.mocked(getEntityThemeSettings).mockResolvedValueOnce({
        light: null,
        dark: null,
        properties,
      });

      await act(async () => {
        await useEntityThemeStore.getState().updateThemeSettings();
      });

      expect(applySavedTheme).toHaveBeenCalledWith(properties);
    });

    it("should update with provided settings", async () => {
      const settings: EntityThemeSettings = {
        light: createMockThemeSettings({ appTheme: createMockAppTheme() }),
        dark: null,
      };

      await act(async () => {
        await useEntityThemeStore.getState().updateThemeSettings(settings);
      });

      const state = useEntityThemeStore.getState();
      expect(state.light?.appTheme).toEqual(createMockAppTheme());
      expect(getEntityThemeSettings).not.toHaveBeenCalled();
    });

    it("should fetch settings from API when no settings provided", async () => {
      const apiSettings: EntityThemeSettings = {
        light: createMockThemeSettings({ appTheme: createMockAppTheme() }),
        dark: createMockThemeSettings({ appTheme: createMockAppTheme() }),
      };

      vi.mocked(getEntityThemeSettings).mockResolvedValueOnce(apiSettings);

      await act(async () => {
        await useEntityThemeStore.getState().updateThemeSettings();
      });

      expect(getEntityThemeSettings).toHaveBeenCalled();
      const state = useEntityThemeStore.getState();
      expect(state.light?.appTheme).toEqual(createMockAppTheme());
      expect(state.dark?.appTheme).toEqual(createMockAppTheme());
    });

    it("should replace null values with defaults when fetching from API", async () => {
      const apiSettings = {
        light: null,
        dark: createMockThemeSettings({ appTheme: createMockAppTheme() }),
      };

      vi.mocked(getEntityThemeSettings).mockResolvedValueOnce(partial(apiSettings));

      await act(async () => {
        await useEntityThemeStore.getState().updateThemeSettings();
      });

      const state = useEntityThemeStore.getState();
      expect(state.light).toEqual({ appTheme: null });
      expect(state.dark?.appTheme).toEqual(createMockAppTheme());
    });

    it("should handle both modes having null values", async () => {
      vi.mocked(getEntityThemeSettings).mockResolvedValueOnce({
        light: null,
        dark: null,
      });

      await act(async () => {
        await useEntityThemeStore.getState().updateThemeSettings();
      });

      const state = useEntityThemeStore.getState();
      expect(state.light).toEqual({ appTheme: null });
      expect(state.dark).toEqual({ appTheme: null });
    });
  });

  describe("saveThemeSettings", () => {
    beforeEach(() => {
      vi.mocked(getEntityThemeSettings).mockResolvedValue({
        light: null,
        dark: null,
      });
    });

    it("should save app theme settings (grouping)", async () => {
      const appTheme = createMockAppTheme();
      const settings: EntityThemeSettings = {
        light: createMockThemeSettings({ appTheme }),
        dark: null,
      };

      await act(async () => {
        await useEntityThemeStore.getState().saveThemeSettings(settings);
      });

      expect(updateEntityThemeSettings).toHaveBeenCalledWith({
        light: { appTheme },
        dark: null,
      });
      expect(toast.success).toHaveBeenCalledWith("Theme settings updated.", {
        id: "theme-settings-update",
        description: "Grouping theme settings updated.",
      });
    });

    it("should merge with existing settings from API", async () => {
      const existingSettings: EntityThemeSettings = {
        light: null,
        dark: createMockThemeSettings({ appTheme: createMockAppTheme() }),
      };

      vi.mocked(getEntityThemeSettings).mockResolvedValueOnce(existingSettings);

      const lightTheme = { grouping: { palette: ["#123456"] } };
      await act(async () => {
        await useEntityThemeStore.getState().saveThemeSettings({
          light: createMockThemeSettings({ appTheme: lightTheme }),
          dark: null,
        });
      });

      const callArg = vi.mocked(updateEntityThemeSettings).mock.calls[0][0];
      expect(callArg.light?.appTheme).toEqual(lightTheme);
      expect(callArg.dark?.appTheme).toEqual(createMockAppTheme());
    });

    it("should leave a mode unchanged when its settings have no appTheme key", async () => {
      const existingSettings: EntityThemeSettings = {
        light: createMockThemeSettings({ appTheme: createMockAppTheme() }),
        dark: null,
      };

      vi.mocked(getEntityThemeSettings).mockResolvedValueOnce(existingSettings);

      await act(async () => {
        await useEntityThemeStore.getState().saveThemeSettings({
          light: createMockThemeSettings(),
          dark: null,
        });
      });

      const state = useEntityThemeStore.getState();
      expect(state.light?.appTheme).toEqual(createMockAppTheme());
    });

    it("should update local state after saving", async () => {
      const appTheme = createMockAppTheme();

      await act(async () => {
        await useEntityThemeStore.getState().saveThemeSettings({
          light: null,
          dark: createMockThemeSettings({ appTheme }),
        });
      });

      expect(useEntityThemeStore.getState().dark?.appTheme).toEqual(appTheme);
    });
  });

  describe("state isolation between modes", () => {
    it("should maintain separate state for light and dark modes", async () => {
      const settings: EntityThemeSettings = {
        light: createMockThemeSettings({
          appTheme: { grouping: { palette: ["#ffffff"] } },
        }),
        dark: createMockThemeSettings({
          appTheme: { grouping: { palette: ["#1a1a1a"] } },
        }),
      };

      await act(async () => {
        await useEntityThemeStore.getState().updateThemeSettings(settings);
      });

      const state = useEntityThemeStore.getState();
      expect(state.light?.appTheme?.grouping.palette[0]).toBe("#ffffff");
      expect(state.dark?.appTheme?.grouping.palette[0]).toBe("#1a1a1a");
    });
  });
});
