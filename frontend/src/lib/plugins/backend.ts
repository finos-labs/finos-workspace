/**
 * Plugin installations and entity enablements kept by the Workspace API
 * (backend routers/plugins.py): a super administrator installs or uninstalls plugins for
 * everyone, an entity administrator enables installed plugins for their organization,
 * and the API answers each user with their own organization's choices. These replace
 * the localStorage implementations the POC used, behind the same services.
 */
import { apiClient } from "~/api/api";
import { errorMessage } from "~/api/errors";
import { PluginApprovalSchema, type PluginApprovalService } from "./approvals";
import type { EntityPluginService } from "./entityPlugins";

const installationPath = (pluginId: string) =>
  `/plugins/installations/${encodeURIComponent(pluginId)}`;
const entityPluginPath = (pluginId: string) =>
  `/plugins/entity/${encodeURIComponent(pluginId)}`;

/** Runs a request, turning a refusal into an Error that says what the API said. */
async function request<T>(send: () => Promise<{ data: T }>, fallback: string) {
  try {
    return (await send()).data;
  } catch (error) {
    throw new Error(errorMessage(error, fallback));
  }
}

export const apiPluginApprovals: PluginApprovalService = {
  async getApprovals() {
    const items = await request(
      () => apiClient.get<unknown[]>("/plugins/installations"),
      "Could not load the installed plugins",
    );
    // An entry this version of the app can't read counts as not installed.
    return items.flatMap((item) => {
      const result = PluginApprovalSchema.safeParse(item);
      return result.success ? [result.data] : [];
    });
  },
  async approve({ pluginId, version, digest, files, requests, releaseNotes, source }) {
    await request(
      () =>
        apiClient.put(installationPath(pluginId), {
          version,
          digest,
          files,
          requests,
          releaseNotes,
          source,
        }),
      `Could not install ${pluginId}`,
    );
  },
  async revoke(pluginId) {
    await request(
      () => apiClient.delete(installationPath(pluginId)),
      `Could not uninstall ${pluginId}`,
    );
  },
};

export const apiEntityPlugins: EntityPluginService = {
  async getEnabledPluginIds() {
    const { pluginIds } = await request(
      () => apiClient.get<{ pluginIds: string[] }>("/plugins/entity"),
      "Could not load your organization's plugins",
    );
    return pluginIds;
  },
  async enable(pluginId) {
    await request(
      () => apiClient.put(entityPluginPath(pluginId)),
      `Could not enable ${pluginId}`,
    );
  },
  async disable(pluginId) {
    await request(
      () => apiClient.delete(entityPluginPath(pluginId)),
      `Could not disable ${pluginId}`,
    );
  },
  // Uninstalling (revoke) already removed the plugin from every organization.
  disableEverywhere: async () => {},
};
