/**
 * Public API of the Workspace plugin layer. Import from "~/lib/plugins" rather than
 * from the individual files.
 */
export { allowAllEntitlements, type EntitlementService } from "./entitlements";
export { isPluginHostUrl, parsePluginHost, REGISTRY_PATH } from "./pluginHost";
export {
  createPluginManager,
  type PluginAvailability,
  PluginHostNotConfiguredError,
  type PluginManager,
} from "./pluginManager";
export {
  fetchRegistry,
  type PluginMetadata,
  PluginRegistryError,
  type PluginSetting,
  type PluginSettingValues,
  type PluginStatus,
  parseRegistry,
} from "./registry";
