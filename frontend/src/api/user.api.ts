import { useThemeStore } from "~/lib/state/theme";
import type { DisplaySettings } from "~/types/auth.type";
import { apiClient } from "./api";

export async function updateUserDisplaySettings(settings?: DisplaySettings) {
  if (!settings) {
    settings = useThemeStore.getState().getDisplaySettings();
  }

  apiClient.post("/app/display-settings", settings).catch((e) => {
    console.error(e);
  });
}
