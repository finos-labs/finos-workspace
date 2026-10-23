/**
 * Entity plugin enablement: which installed plugins an entity administrator turned on
 * for their organization. A super administrator installs a plugin (approvals.ts); only
 * then can an entity administrator enable it, and only an installed plugin that is
 * enabled for the user's entity reaches that entity's users and dashboards. The POC
 * keeps enablements in this browser's localStorage, keyed by entity; a backend
 * implementation of EntityPluginService can replace it without UI changes.
 */
import { z } from "zod";

export const ENTITY_PLUGINS_STORAGE_KEY = "bq-plugins:entity-enablements";

/** Entity key used when the signed-in user belongs to no named entity. */
const NO_ENTITY = "";

const EnablementsSchema = z.record(z.string(), z.array(z.string()));

type Enablements = z.infer<typeof EnablementsSchema>;

export interface EntityPluginService {
  /** Ids of the plugins enabled for the signed-in user's entity. */
  getEnabledPluginIds(): Promise<string[]>;
  enable(pluginId: string): Promise<void>;
  disable(pluginId: string): Promise<void>;
  /** Disables the plugin for every entity, e.g. when it is uninstalled. */
  disableEverywhere(pluginId: string): Promise<void>;
}

function readEnablements(storage: Storage): Enablements {
  try {
    const result = EnablementsSchema.safeParse(
      JSON.parse(storage.getItem(ENTITY_PLUGINS_STORAGE_KEY) ?? "{}"),
    );
    return result.success ? result.data : {};
  } catch {
    return {}; // unreadable or blocked storage: nothing is enabled
  }
}

export function createLocalEntityPlugins(
  getEntity: () => string | null | undefined,
  getStorage: () => Storage = () => window.localStorage,
): EntityPluginService {
  const entity = () => getEntity() ?? NO_ENTITY;
  const update = (change: (enablements: Enablements) => Enablements) => {
    const storage = getStorage();
    storage.setItem(
      ENTITY_PLUGINS_STORAGE_KEY,
      JSON.stringify(change(readEnablements(storage))),
    );
  };

  return {
    getEnabledPluginIds: async () => readEnablements(getStorage())[entity()] ?? [],
    async enable(pluginId) {
      update((enablements) => {
        const ids = enablements[entity()] ?? [];
        return ids.includes(pluginId)
          ? enablements
          : { ...enablements, [entity()]: [...ids, pluginId] };
      });
    },
    async disable(pluginId) {
      update((enablements) => ({
        ...enablements,
        [entity()]: (enablements[entity()] ?? []).filter((id) => id !== pluginId),
      }));
    },
    async disableEverywhere(pluginId) {
      update((enablements) =>
        Object.fromEntries(
          Object.entries(enablements).map(([key, ids]) => [
            key,
            ids.filter((id) => id !== pluginId),
          ]),
        ),
      );
    },
  };
}
