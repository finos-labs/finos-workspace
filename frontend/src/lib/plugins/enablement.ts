/**
 * Whether a plugin is enabled. The state is global: one flag per plugin, the same for
 * every user and every dashboard. Plugins are disabled until an administrator enables
 * them. The POC keeps the flags in this browser's localStorage; a backend
 * implementation of PluginEnablementService can replace it without UI changes.
 */
export interface PluginEnablementService {
  /** Ids of the enabled plugins. */
  getEnabledPluginIds(): Promise<string[]>;
  setPluginEnabled(pluginId: string, enabled: boolean): Promise<void>;
}

export const PLUGIN_ENABLEMENT_STORAGE_KEY = "bq-plugins:enabled";

function readIds(storage: Storage): string[] {
  try {
    const value: unknown = JSON.parse(
      storage.getItem(PLUGIN_ENABLEMENT_STORAGE_KEY) ?? "[]",
    );
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return []; // unreadable or blocked storage: treat every plugin as disabled
  }
}

export function createLocalPluginEnablement(
  getStorage: () => Storage = () => window.localStorage,
): PluginEnablementService {
  return {
    getEnabledPluginIds: async () => readIds(getStorage()),
    async setPluginEnabled(pluginId, enabled) {
      const storage = getStorage();
      const ids = new Set(readIds(storage));
      if (enabled) ids.add(pluginId);
      else ids.delete(pluginId);
      storage.setItem(PLUGIN_ENABLEMENT_STORAGE_KEY, JSON.stringify([...ids]));
    },
  };
}

export const localPluginEnablement = createLocalPluginEnablement();
