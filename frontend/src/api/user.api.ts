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

/** Which of the user's own provider keys the API holds; the key values never come back. */
export type CopilotKeysStatus = {
  has_openai_key: boolean;
  has_perplexity_key: boolean;
};

/** A key sets it, null removes it, and a key left out stays as it is. */
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
