/**
 * Public API of the Workspace plugin layer. Import from "~/lib/plugins" rather than
 * from the individual files.
 */
export {
  createLocalPluginEnablement,
  localPluginEnablement,
  PLUGIN_ENABLEMENT_STORAGE_KEY,
  type PluginEnablementService,
} from "./enablement";
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
  type PluginStatus,
  parseRegistry,
} from "./registry";
