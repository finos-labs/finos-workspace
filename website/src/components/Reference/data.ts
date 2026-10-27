import agent from "../../generated/agent.json";
import api from "../../generated/api.json";
import appsSchema from "../../generated/appsSchema.json";
import bridge from "../../generated/bridge.json";
import cli from "../../generated/cli.json";
import css from "../../generated/css.json";
import database from "../../generated/database.json";
import env from "../../generated/env.json";
import manifestSchema from "../../generated/manifestSchema.json";
import mcp from "../../generated/mcp.json";
import plugins from "../../generated/plugins.json";
import settings from "../../generated/settings.json";
import web from "../../generated/web.json";
import webConfig from "../../generated/webConfig.json";
import widgetsSchema from "../../generated/widgetsSchema.json";
import type {
  AgentData,
  ApiData,
  BridgeData,
  CliData,
  CssData,
  DatabaseData,
  EnvData,
  McpData,
  PluginsData,
  SchemaSet,
  SettingsData,
  WebConfigData,
  WebData,
} from "../../data/types";

export const agentData = agent as unknown as AgentData;
export const apiData = api as unknown as ApiData;
const appsSchemaData = appsSchema as unknown as SchemaSet;
export const bridgeData = bridge as unknown as BridgeData;
export const cliData = cli as unknown as CliData;
export const cssData = css as unknown as CssData;
export const databaseData = database as unknown as DatabaseData;
export const envData = env as unknown as EnvData;
const manifestSchemaData = manifestSchema as unknown as SchemaSet;
export const mcpData = mcp as unknown as McpData;
export const pluginsData = plugins as unknown as PluginsData;
export const settingsData = settings as unknown as SettingsData;
export const webConfigData = webConfig as unknown as WebConfigData;
export const webData = web as unknown as WebData;
const widgetsSchemaData = widgetsSchema as unknown as SchemaSet;

export const schemaSets = {
  widgets: widgetsSchemaData,
  apps: appsSchemaData,
  manifest: manifestSchemaData,
  api: { source: "openapi.json", title: "FINOS Workspace API", definitions: apiData.schemas } as SchemaSet,
};
