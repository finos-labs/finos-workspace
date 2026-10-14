import type { ComposedWidgetsSchema } from "~/lib/utils/widgetsSchemaValidation";
import type { FrameFailure } from "~/plugins/PluginFrame";
import { type PluginListing, PluginListingSchema } from "~/plugins/types";
import { apiClient } from "./api";

/** Widget plugin endpoints (docs/widget-plugins/DESIGN.md 7.1). */

export async function getAvailablePlugins(): Promise<PluginListing> {
  const { data } = await apiClient.get("/app/widget-plugins");
  return PluginListingSchema.parse(data);
}

/** The widgets.json schema in force for the user's entity (WIDGETS-JSON.md 3.5). */
export async function getWidgetsSchema(): Promise<ComposedWidgetsSchema> {
  const { data } = await apiClient.get<ComposedWidgetsSchema>(
    "/app/widget-plugins/widgets-schema",
  );
  if (!data?.$id || !Array.isArray(data["x-types"]) || !data.definitions)
    throw new Error(
      "The API answered with something that is not a widgets.json schema",
    );
  return data;
}

/** The bytes of one file of an available plugin, for the host to verify. */
export async function getPluginFile(
  pluginId: string,
  digest: string,
  path: string,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const { data } = await apiClient.get<ArrayBuffer>(
    `/app/widget-plugins/${encodeURIComponent(pluginId)}/${encodeURIComponent(digest)}/files/${encoded}`,
    { responseType: "arraybuffer", signal },
  );
  return data;
}

/**
 * A widget's call to a proxy its plugin declares (SERVER-SIDE.md 3.4). The API fills the
 * template, adds the plugin's secrets and answers with the body and its content type.
 */
export async function callPluginProxy(
  pluginId: string,
  proxyId: string,
  body: { widget: string; args: Record<string, unknown> },
  signal?: AbortSignal,
) {
  const { data } = await apiClient.post<{ content_type: string; body: unknown }>(
    `/app/widget-plugins/${encodeURIComponent(pluginId)}/proxy/${encodeURIComponent(proxyId)}`,
    body,
    { signal },
  );
  return data;
}

/** A widget's call to a route of its plugin's backend (SERVER-SIDE.md 5.6). */
export async function callPluginBackend(
  pluginId: string,
  routeId: string,
  body: { widget: string; instance: string; args: Record<string, unknown> },
  signal?: AbortSignal,
) {
  const { data } = await apiClient.post<{ body: unknown }>(
    `/app/widget-plugins/${encodeURIComponent(pluginId)}/backend/${encodeURIComponent(routeId)}`,
    body,
    { signal },
  );
  return data;
}

export async function postPluginReports(body: {
  plugin_id: string;
  version: string;
  reports?: { directive: string; origin: string }[];
  /** How the frame failed, when it did */
  failure?: FrameFailure["kind"];
}) {
  await apiClient.post("/app/widget-plugins/report", body);
}

// -- Superusers --------------------------------------------------------------

export type VersionState = "discovered" | "active" | "blocked" | "retired" | "missing";
export type PluginStatus = "disabled" | "enabled" | "revoked";
export type Risk = "none" | "low" | "medium" | "high" | "critical";

export interface ReviewItem {
  key: string;
  family:
    | "widgets"
    | "permissions"
    | "network"
    | "proxies"
    | "secrets"
    | "backend"
    | "data"
    | "code";
  label: string;
  risk: Risk;
  added: boolean;
  removed?: boolean;
  overridden?: boolean;
}

export interface PlatformVersion {
  version: string;
  state: VersionState;
  blocked_reason: string | null;
  digest: string | null;
  declared_checksum: string | null;
  pin_status: "pinned" | "unpinned" | "mismatch";
  path: string;
  files: Record<string, { size: number; sha256: string }>;
  findings: { errors: string[]; warnings: string[] };
  discovered_at: string | null;
  approved_at: string | null;
  approved_by_uuid: string | null;
  manifest: Record<string, unknown> & {
    name?: string;
    description?: string;
    publisher?: { name: string; url?: string };
    contributes?: {
      widgets?: {
        id: string;
        name: string;
        description?: string;
        handles?: { type: string }[];
        permissions?: string[];
        standalone?: boolean;
      }[];
    };
  };
  csp: {
    declared: Record<string, string[]>;
    notes: Record<string, string>;
    approved: Record<string, string[]>;
    effective: Record<string, string[]>;
    egress: string[];
    risk: Record<string, Risk>;
  };
  /** The server side (SERVER-SIDE.md 3 and 4): hosts, request templates, secrets. */
  server: {
    network: { declared: string[]; approved: string[] };
    private: boolean;
    proxies: PluginProxy[];
    secrets: { name: string; purpose: string }[];
    backend: { protocol: number; routes: PluginRoute[] } | null;
    data_sources: { id: string; purpose: string }[];
    identity: "none" | "pseudonymous";
  };
  review: ReviewItem[] | null;
}

export interface PluginProxy {
  id: string;
  method?: "GET" | "POST";
  url: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  args?: Record<string, { type: string; required?: boolean }>;
  response?: { accepts?: string[]; maxBytes?: number; timeoutMs?: number };
}

export interface PluginRoute {
  id: string;
  args?: Record<string, { type: string; required?: boolean }>;
  secrets?: string[];
  response?: { maxBytes?: number; timeoutMs?: number };
}

/** Whether the deployment runs the plugin's backend, and the last identity check. */
export interface PluginBackendStatus {
  registered: boolean;
  identity: {
    state: "ok" | "mismatch" | "unreachable" | "unregistered";
    detail: string;
    digest: string | null;
    checked_at: number;
  } | null;
  breaker: "open" | "closed";
}

/** Whether a secret has a value, who set it and when; never the value. */
export interface PluginSecretStatus {
  name: string;
  purpose: string;
  /** False for a stored value no version declares any more. */
  declared: boolean;
  set: boolean;
  source: "configuration" | "admin" | null;
  problem: string | null;
  set_by_uuid: string | null;
  set_at: string | null;
}

export interface PlatformPlugin {
  plugin_id: string;
  name: string;
  status: PluginStatus;
  active_version: string | null;
  update_available: string | null;
  overrides: {
    csp?: Record<string, string[]>;
    server_network?: string[];
    confirmations?: string[];
  };
  enabled_entities: number;
  enabled_for: { entity_uuid: string; access_mode: "everyone" | "roles" }[];
  versions: PlatformVersion[];
  secrets: PluginSecretStatus[];
  backend: PluginBackendStatus;
}

export interface PluginEvent {
  action: string;
  version: string | null;
  entity_uuid: string | null;
  actor_uuid: string | null;
  details: Record<string, unknown>;
  created_date: string;
}

export interface CspReport {
  directive: string;
  origin: string;
  count: number;
  version: string;
  entity_uuid: string;
  first_seen: string;
  last_seen: string;
}

export interface RescanSummary {
  discovered: string[];
  blocked: string[];
  missing: string[];
  restored: string[];
  rejected: string[];
}

export async function getPlatformPlugins() {
  const { data } = await apiClient.get<{ enabled: boolean; plugins: PlatformPlugin[] }>(
    "/plugins",
  );
  return data;
}

export async function rescanPlugins() {
  const { data } = await apiClient.post<RescanSummary>("/plugins/rescan");
  return data;
}

export async function approvePluginVersion(
  pluginId: string,
  version: string,
  body: { digest: string; acknowledged: string[] },
) {
  const { data } = await apiClient.post(
    `/plugins/${pluginId}/versions/${version}/approve`,
    body,
  );
  return data;
}

export async function setPluginRevoked(pluginId: string, revoked: boolean) {
  const { data } = await apiClient.post(
    `/plugins/${pluginId}/${revoked ? "revoke" : "restore"}`,
  );
  return data;
}

/** Replace the plugin's overrides: whatever the body leaves out is dropped. */
export async function putPluginOverrides(
  pluginId: string,
  body: {
    csp: Record<string, string[]> | null;
    server_network: string[] | null;
    confirmations: string[];
  },
) {
  const { data } = await apiClient.put(`/plugins/${pluginId}/overrides`, body);
  return data;
}

/** Set a secret's value. Write-only: no endpoint returns it. */
export async function putPluginSecret(pluginId: string, name: string, value: string) {
  await apiClient.put(`/plugins/${pluginId}/secrets/${name}`, { value });
}

export async function deletePluginSecret(pluginId: string, name: string) {
  await apiClient.delete(`/plugins/${pluginId}/secrets/${name}`);
}

/** Ask the plugin's backend for its identity now. */
export async function checkPluginBackend(pluginId: string) {
  const { data } = await apiClient.post<PluginBackendStatus>(
    `/plugins/${pluginId}/backend/check`,
  );
  return data;
}

export async function getPluginEvents(pluginId: string, scope: "platform" | "entity") {
  const prefix = scope === "platform" ? "/plugins" : "/admin/plugins";
  const { data } = await apiClient.get<PluginEvent[]>(`${prefix}/${pluginId}/events`);
  return data;
}

export async function getPluginReports(pluginId: string, scope: "platform" | "entity") {
  const prefix = scope === "platform" ? "/plugins" : "/admin/plugins";
  const { data } = await apiClient.get<CspReport[]>(
    `${prefix}/${pluginId}/csp-reports`,
  );
  return data;
}

export async function forgetPlugin(pluginId: string) {
  await apiClient.delete(`/plugins/${pluginId}`);
}

export interface PluginEntityUse {
  entity_uuid: string;
  name: string | null;
  enabled: boolean;
  access_mode: "everyone" | "roles" | null;
}

/** One plugin with how every entity uses it, and its latest events. */
export async function getPlatformPlugin(pluginId: string) {
  const { data } = await apiClient.get<
    PlatformPlugin & { entities: PluginEntityUse[]; events: PluginEvent[] }
  >(`/plugins/${pluginId}`);
  return data;
}

/** Enable or disable a plugin for one entity, or for every entity when none is named. */
export async function putPluginEntity(
  pluginId: string,
  entityUuid: string | null,
  changes: { enabled: boolean; access_mode?: "everyone" | "roles" },
) {
  const path = entityUuid
    ? `/plugins/${pluginId}/entities/${entityUuid}`
    : `/plugins/${pluginId}/entities`;
  const { data } = await apiClient.put(path, changes);
  return data;
}

// -- Entity admins -------------------------------------------------------------

export interface EntityPlugin {
  plugin_id: string;
  name: string;
  status: PluginStatus;
  active_version: string;
  available: boolean;
  description: string;
  publisher: { name: string; url?: string } | null;
  widgets: {
    id: string;
    name: string;
    description: string;
    handles: string[];
    standalone: boolean;
    permissions: string[];
  }[];
  admin_settings_schema: Record<string, unknown> | null;
  enabled: boolean;
  access_mode: "everyone" | "roles";
  settings: Record<string, unknown>;
  narrowed_permissions: string[];
  csp_narrow: Record<string, string[]>;
  csp: {
    approved: Record<string, string[]>;
    effective: Record<string, string[]>;
    egress: string[];
  };
  /** Hosts of the approved server network removed for this organization. */
  server_network_narrow: string[];
  /** The data sources the plugin's backend reads, and the backend serving each here. */
  data_sources: { id: string; purpose: string; backend_uuid: string | null }[];
  server: {
    network: { approved: string[]; effective: string[] };
    proxies: string[];
  };
  handlers: Record<string, string>;
  role_grants: number;
}

export interface EntityPluginChanges {
  enabled?: boolean;
  access_mode?: "everyone" | "roles";
  narrowed_permissions?: string[];
  csp_narrow?: Record<string, string[]>;
  server_network_narrow?: string[];
  data_sources?: Record<string, string | null>;
  settings?: Record<string, unknown>;
  handlers?: Record<string, string | null>;
}

export async function getEntityPlugins() {
  const { data } = await apiClient.get<{
    enabled: boolean;
    plugins: EntityPlugin[];
    /** The organization's backends, which can serve the plugins' data sources */
    backends: { uuid: string; name: string }[];
  }>("/admin/plugins");
  return data;
}

export async function putEntityPlugin(pluginId: string, changes: EntityPluginChanges) {
  const { data } = await apiClient.put(`/admin/plugins/${pluginId}`, changes);
  return data;
}

export interface PluginGrant {
  plugin_id: string;
  widget_id: string;
}

export async function getRolePluginAccess(roleUuid: string) {
  const { data } = await apiClient.get<{ grants: PluginGrant[] }>(
    `/admin/role/${roleUuid}/plugin-access`,
  );
  return data.grants;
}

export async function putRolePluginAccess(roleUuid: string, grants: PluginGrant[]) {
  const { data } = await apiClient.put(`/admin/role/${roleUuid}/plugin-access`, {
    grants,
  });
  return data;
}
