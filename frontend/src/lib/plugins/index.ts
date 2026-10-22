/**
 * Public API of the Workspace plugin layer. Import from "~/lib/plugins" rather than
 * from the individual files.
 */
export {
  createLocalPluginApprovals,
  localPluginApprovals,
  PLUGIN_APPROVALS_STORAGE_KEY,
  type PluginApproval,
  type PluginApprovalService,
} from "./approvals";
export { allowAllEntitlements, type EntitlementService } from "./entitlements";
export { isPluginHostUrl, parsePluginHost, REGISTRY_PATH } from "./pluginHost";
export {
  createPluginManager,
  type PluginAvailability,
  PluginHostNotConfiguredError,
  type PluginManager,
  type PluginReleaseState,
  resolveReleaseState,
} from "./pluginManager";
export {
  fetchRegistry,
  type PluginMetadata,
  PluginRegistryError,
  type PluginRequests,
  type PluginStatus,
  parseRegistry,
} from "./registry";
export {
  compareVersions,
  describeRequests,
  diffReleases,
  latestRelease,
  type PluginRelease,
  parseReleases,
  type ReleaseDiff,
} from "./releases";
