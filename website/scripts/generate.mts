import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AgentData, ApiData, BridgeData, CssData, PluginsData, SettingsData, WebConfigData } from "../src/data/types.ts";
import {
  collectApi,
  collectAppsSchema,
  collectCli,
  collectDatabase,
  collectManifestSchema,
  collectMcp,
  collectSettings,
  collectWidgetArgs,
  collectWidgetsSchema,
} from "./lib/backend.mts";
import { collectAgentsJson } from "./lib/agentsJson.mts";
import { checkAgreement } from "./lib/agreement.mts";
import { collectCss } from "./lib/css.mts";
import { collectAgent } from "./lib/agent.mts";
import { collectBridge } from "./lib/bridge.mts";
import { checkAbuseCases, checkCoverage, checkExampleListings, checkRoutes, checkSettingNames } from "./lib/coverage.mts";
import { collectEnv } from "./lib/env.mts";
import { collectIframe } from "./lib/iframe.mts";
import { collectPlugins } from "./lib/plugins.mts";
import { collectHtmlSurfaces, collectProtocolCases } from "./lib/protocolCases.mts";
import { outDir } from "./lib/paths.mts";
import { collectPluginTokens, collectReport } from "./lib/theme.mts";
import { addUsage } from "./lib/usage.mts";
import { collectWeb } from "./lib/web.mts";
import { collectWidgetRequests } from "./lib/widgetRequests.mts";
import { collectWebConfig } from "./lib/webConfig.mts";

const env = await collectEnv();
const parsedCss = collectCss();
const css: CssData = {
  ...parsedCss,
  ...addUsage(parsedCss),
  report: collectReport(),
  pluginTokens: collectPluginTokens(parsedCss),
};

const outputs: Record<string, unknown> = {
  css,
  webConfig: await collectWebConfig(),
  env,
  agent: collectAgent(),
  settings: collectSettings(),
  api: collectApi(),
  widgetsSchema: collectWidgetsSchema(),
  widgetArgs: collectWidgetArgs(),
  agentsJson: collectAgentsJson(),
  widgetRequests: collectWidgetRequests(),
  iframe: collectIframe(),
  protocolCases: collectProtocolCases(),
  htmlSurfaces: collectHtmlSurfaces(),
  appsSchema: collectAppsSchema(),
  manifestSchema: collectManifestSchema(),
  database: collectDatabase(),
  cli: collectCli(),
  mcp: collectMcp(),
  plugins: collectPlugins(),
  bridge: collectBridge(),
  web: collectWeb(),
};

checkAgreement();
checkAbuseCases();
checkExampleListings();
const settingNames = new Set<string>([
  ...(outputs.settings as SettingsData).fields.map((field) => field.name.toUpperCase()),
  ...env.agent.map((variable) => variable.name),
  ...(outputs.webConfig as WebConfigData).groups.flatMap((group) => group.fields.flatMap((field) => [field.containerVariable, field.buildVariable])),
  ...(outputs.webConfig as WebConfigData).buildVariables.map((variable) => variable.name),
]);
checkSettingNames(settingNames, ["docs/reference/configuration/overview.md", "docs/reference/css/html-documents.mdx"]);
checkCoverage(outputs.plugins as PluginsData, outputs.agent as AgentData);
checkRoutes(outputs.api as ApiData, outputs.agent as AgentData, outputs.bridge as BridgeData, outputs.plugins as PluginsData);

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
for (const [name, data] of Object.entries(outputs)) {
  writeFileSync(resolve(outDir, `${name}.json`), JSON.stringify(data));
}
