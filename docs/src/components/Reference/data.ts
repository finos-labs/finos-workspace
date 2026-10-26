import api from "../../generated/api.json";
import appsSchema from "../../generated/appsSchema.json";
import cli from "../../generated/cli.json";
import css from "../../generated/css.json";
import database from "../../generated/database.json";
import env from "../../generated/env.json";
import hooks from "../../generated/hooks.json";
import manifestSchema from "../../generated/manifestSchema.json";
import mcp from "../../generated/mcp.json";
import settings from "../../generated/settings.json";
import webConfig from "../../generated/webConfig.json";
import widgetsSchema from "../../generated/widgetsSchema.json";
import type {
  ApiData,
  CliData,
  CssData,
  DatabaseData,
  EnvData,
  HooksData,
  McpData,
  SchemaSet,
  SettingsData,
  WebConfigData,
} from "../../data/types";

export const apiData = api as unknown as ApiData;
export const appsSchemaData = appsSchema as unknown as SchemaSet;
export const cliData = cli as unknown as CliData;
export const cssData = css as unknown as CssData;
export const databaseData = database as unknown as DatabaseData;
export const envData = env as unknown as EnvData;
export const hooksData = hooks as unknown as HooksData;
export const manifestSchemaData = manifestSchema as unknown as SchemaSet;
export const mcpData = mcp as unknown as McpData;
export const settingsData = settings as unknown as SettingsData;
export const webConfigData = webConfig as unknown as WebConfigData;
export const widgetsSchemaData = widgetsSchema as unknown as SchemaSet;

export const schemaSets = {
  widgets: widgetsSchemaData,
  apps: appsSchemaData,
  manifest: manifestSchemaData,
  api: { source: "openapi.json", title: "Workspace API", definitions: apiData.schemas } as SchemaSet,
};
