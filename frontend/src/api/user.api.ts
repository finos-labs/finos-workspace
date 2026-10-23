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

export type CopilotKeysStatus = {
  has_openai_key: boolean;
  has_perplexity_key: boolean;
};

export type CopilotKeysUpdate = {
  openai_api_key?: string | null;
  perplexity_api_key?: string | null;
};

export async function getCopilotKeys(): Promise<CopilotKeysStatus> {
  const { data } = await apiClient.get<CopilotKeysStatus>("/app/copilot-keys");
  return data;
}

export async function putCopilotKeys(
  keys: CopilotKeysUpdate,
): Promise<CopilotKeysStatus> {
  const { data } = await apiClient.put<CopilotKeysStatus>("/app/copilot-keys", keys);
  return data;
}
