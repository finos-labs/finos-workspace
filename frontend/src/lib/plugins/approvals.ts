/**
 * Plugin approvals: which version of each plugin an administrator enabled, pinned by
 * the release digest. An approval is global (one per plugin, for every user and
 * dashboard) and keeps a snapshot of the approved release, so a later version can be
 * reviewed against it and a changed release is detected. The POC keeps approvals in
 * this browser's localStorage; a backend implementation of PluginApprovalService can
 * replace it without UI changes.
 */
import { z } from "zod";
import { PluginRequestsSchema } from "./registry";
import { PluginReleaseSchema } from "./releases";

export const PLUGIN_APPROVALS_STORAGE_KEY = "bq-plugins:approvals";

export const PluginApprovalSchema = z.object({
  pluginId: z.string(),
  version: PluginReleaseSchema.shape.version,
  digest: PluginReleaseSchema.shape.digest,
  files: PluginReleaseSchema.shape.files,
  requests: PluginRequestsSchema.nullable(),
  releaseNotes: z.string().nullable(),
  source: z.object({ commit: z.string() }).nullable(),
  approvedAt: z.string(),
});

export type PluginApproval = z.infer<typeof PluginApprovalSchema>;

export interface PluginApprovalService {
  getApprovals(): Promise<PluginApproval[]>;
  /** Records an approval, replacing any earlier one for the same plugin. */
  approve(approval: PluginApproval): Promise<void>;
  /** Removes the plugin's approval: it is disabled everywhere. */
  revoke(pluginId: string): Promise<void>;
}

function readApprovals(storage: Storage): PluginApproval[] {
  try {
    const value: unknown = JSON.parse(
      storage.getItem(PLUGIN_APPROVALS_STORAGE_KEY) ?? "[]",
    );
    if (!Array.isArray(value)) return [];
    // Unreadable entries are dropped: that plugin counts as not approved.
    return value.flatMap((entry) => {
      const result = PluginApprovalSchema.safeParse(entry);
      return result.success ? [result.data] : [];
    });
  } catch {
    return []; // unreadable or blocked storage: nothing is approved
  }
}

export function createLocalPluginApprovals(
  getStorage: () => Storage = () => window.localStorage,
): PluginApprovalService {
  const write = (storage: Storage, approvals: PluginApproval[]) =>
    storage.setItem(PLUGIN_APPROVALS_STORAGE_KEY, JSON.stringify(approvals));

  return {
    getApprovals: async () => readApprovals(getStorage()),
    async approve(approval) {
      const storage = getStorage();
      const others = readApprovals(storage).filter(
        (item) => item.pluginId !== approval.pluginId,
      );
      write(storage, [...others, approval]);
    },
    async revoke(pluginId) {
      const storage = getStorage();
      write(
        storage,
        readApprovals(storage).filter((item) => item.pluginId !== pluginId),
      );
    },
  };
}

export const localPluginApprovals = createLocalPluginApprovals();
