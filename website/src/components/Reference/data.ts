import agent from "../../generated/agent.json";
import agentsJson from "../../generated/agentsJson.json";
import api from "../../generated/api.json";
import appsSchema from "../../generated/appsSchema.json";
import bridge from "../../generated/bridge.json";
import cli from "../../generated/cli.json";
import css from "../../generated/css.json";
import database from "../../generated/database.json";
import env from "../../generated/env.json";
import htmlSurfaces from "../../generated/htmlSurfaces.json";
import iframe from "../../generated/iframe.json";
import manifestSchema from "../../generated/manifestSchema.json";
import mcp from "../../generated/mcp.json";
import plugins from "../../generated/plugins.json";
import protocolCases from "../../generated/protocolCases.json";
import settings from "../../generated/settings.json";
import web from "../../generated/web.json";
import webConfig from "../../generated/webConfig.json";
import widgetArgs from "../../generated/widgetArgs.json";
import widgetRequests from "../../generated/widgetRequests.json";
import widgetsSchema from "../../generated/widgetsSchema.json";
import type {
  AgentData,
  AgentsJsonData,
  ApiData,
  BridgeData,
  CliData,
  CssData,
  DatabaseData,
  EnvData,
  HtmlSurface,
  IframeData,
  McpData,
  PluginsData,
  ProtocolCases,
  SchemaSet,
  SettingsData,
  WebConfigData,
  WebData,
  WidgetRequestData,
} from "../../data/types";

export const agentData = agent as unknown as AgentData;
export const agentsJsonData = agentsJson as unknown as AgentsJsonData;
export const widgetRequestData = widgetRequests as unknown as WidgetRequestData;
export const iframeData = iframe as unknown as IframeData;
export const htmlSurfacesData = htmlSurfaces as unknown as HtmlSurface[];
export const protocolCasesData = protocolCases as unknown as ProtocolCases;
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
const widgetArgsData = widgetArgs as unknown as SchemaSet;
const widgetsSchemaData = widgetsSchema as unknown as SchemaSet;

export const schemaSets = {
  widgets: widgetsSchemaData,
  widgetArgs: widgetArgsData,
  agents: agentsJsonData.schema,
  iframePage: iframeData.fromPage,
  iframeHost: iframeData.fromHost,
  apps: appsSchemaData,
  manifest: manifestSchemaData,
  api: { source: "openapi.json", title: "FINOS Workspace API", definitions: apiData.schemas } as SchemaSet,
};
