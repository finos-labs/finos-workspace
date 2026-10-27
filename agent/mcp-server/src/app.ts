import { StreamableHTTPTransport } from "@hono/mcp";
import { McpServer, type ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ZodRawShape } from "zod";
import { mountBridgeRoutes } from "./bridge/routes.ts";
import { bridgeManager } from "./bridge/singleton.ts";
import type { BridgeSessionManager } from "./bridge/state.ts";
import { honoLogger } from "./lib/logger.ts";
import { observed } from "./lib/observe.ts";
import { requireScope } from "./lib/scope-check.ts";
import { registerWorkspacePrompts } from "./prompts/workspace.ts";
import { listAppBuilderResourceUris, registerAppBuilderResources } from "./resources/app-builder.ts";
import { registerWidgetsSchemaResource } from "./resources/widgets-schema.ts";
import {
  webSearchSchema,
  webSearchHandler,
  webSearchDescription,
} from "./tools/backend/web-search.ts";
import {
  fetchWebpageSchema,
  fetchWebpageHandler,
  fetchWebpageDescription,
} from "./tools/backend/fetch-webpage.ts";
import {
  inspectWebpageSchema,
  inspectWebpageHandler,
  inspectWebpageDescription,
} from "./tools/backend/inspect-webpage.ts";
import {
  queryDocumentsSchema,
  queryDocumentsHandler,
  queryDocumentsDescription,
} from "./tools/backend/documents/query-documents.ts";
import {
  listDocumentsSchema,
  listDocumentsHandler,
  listDocumentsDescription,
} from "./tools/backend/documents/list-documents.ts";
import {
  getWorkspaceSnapshotSchema,
  getWorkspaceSnapshotHandler,
  getWorkspaceSnapshotDescription,
} from "./tools/workspace/get-workspace-snapshot.ts";
import {
  listAvailableWidgetsSchema,
  listAvailableWidgetsHandler,
  listAvailableWidgetsDescription,
} from "./tools/workspace/list-available-widgets.ts";
import {
  getWidgetSchemaSchema,
  getWidgetSchemaHandler,
  getWidgetSchemaDescription,
} from "./tools/workspace/get-widget-schema.ts";
import {
  readWidgetSchema,
  readWidgetHandler,
  readWidgetDescription,
} from "./tools/workspace/read-widget.ts";
import {
  deleteWidgetSchema,
  deleteWidgetHandler,
  deleteWidgetDescription,
} from "./tools/workspace/delete-widget.ts";
import {
  manageDashboardSchema,
  manageDashboardHandler,
  manageDashboardDescription,
} from "./tools/workspace/manage-dashboard.ts";
import {
  navigateWorkspaceSchema,
  navigateWorkspaceHandler,
  navigateWorkspaceDescription,
} from "./tools/workspace/navigate-workspace.ts";
import {
  manageNavigationBarSchema,
  manageNavigationBarHandler,
  manageNavigationBarDescription,
} from "./tools/workspace/manage-navigation-bar.ts";
import {
  createWidgetSchema,
  createWidgetHandler,
  createWidgetDescription,
} from "./tools/workspace/create-widget.ts";
import {
  updateWidgetSchema,
  updateWidgetHandler,
  updateWidgetDescription,
} from "./tools/workspace/update-widget.ts";
import {
  updateWidgetLayoutSchema,
  updateWidgetLayoutHandler,
  updateWidgetLayoutDescription,
} from "./tools/workspace/update-widget-layout.ts";
import {
  addGenerativeWidgetSchema,
  addGenerativeWidgetHandler,
  addGenerativeWidgetDescription,
} from "./tools/workspace/add-generative-widget.ts";
import {
  getWidgetDataSchema,
  getWidgetDataHandler,
  getWidgetDataDescription,
} from "./tools/workspace/get-widget-data.ts";
import {
  getParamsOptionsSchema,
  getParamsOptionsHandler,
  getParamsOptionsDescription,
} from "./tools/workspace/get-params-options.ts";
import {
  assignTasksToAgentsSchema,
  assignTasksToAgentsHandler,
  assignTasksToAgentsDescription,
} from "./tools/workspace/assign-tasks-to-agents.ts";
import {
  getSkillContentSchema,
  getSkillContentHandler,
  getSkillContentDescription,
} from "./tools/workspace/get-skill-content.ts";
import {
  manageBackendsSchema,
  manageBackendsHandler,
  manageBackendsDescription,
} from "./tools/workspace/manage-backends.ts";
import {
  manageAppsSchema,
  manageAppsHandler,
  manageAppsDescription,
} from "./tools/workspace/manage-apps.ts";

interface McpFeatures {
  documents: boolean;
  companion: boolean;
}

export type ToolGroup = "backend" | "documents" | "workspace";

interface Tool {
  name: string;
  group: ToolGroup;
  scoped: boolean;
  register(mcp: McpServer): void;
}

function tool<Shape extends ZodRawShape>(
  group: ToolGroup,
  name: string,
  description: string,
  schema: Shape,
  handler: ToolCallback<Shape>,
  scoped = false,
): Tool {
  return { name, group, scoped, register: (mcp) => void mcp.tool(name, description, schema, handler) };
}

export const TOOLS: readonly Tool[] = [
  tool("backend", "web_search", webSearchDescription, webSearchSchema, observed("web_search", webSearchHandler)),
  tool("backend", "fetch_webpage", fetchWebpageDescription, fetchWebpageSchema, observed("fetch_webpage", fetchWebpageHandler)),
  tool(
    "backend",
    "inspect_webpage",
    inspectWebpageDescription,
    inspectWebpageSchema,
    observed("inspect_webpage", requireScope(inspectWebpageHandler)),
    true,
  ),
  tool(
    "documents",
    "query_documents",
    queryDocumentsDescription,
    queryDocumentsSchema,
    observed("query_documents", requireScope(queryDocumentsHandler)),
    true,
  ),
  tool(
    "documents",
    "list_documents",
    listDocumentsDescription,
    listDocumentsSchema,
    observed("list_documents", requireScope(listDocumentsHandler)),
    true,
  ),
  tool("workspace", "get_workspace_snapshot", getWorkspaceSnapshotDescription, getWorkspaceSnapshotSchema, getWorkspaceSnapshotHandler),
  tool("workspace", "list_available_widgets", listAvailableWidgetsDescription, listAvailableWidgetsSchema, listAvailableWidgetsHandler),
  tool("workspace", "get_widget_schema", getWidgetSchemaDescription, getWidgetSchemaSchema, getWidgetSchemaHandler),
  tool("workspace", "read_widget", readWidgetDescription, readWidgetSchema, readWidgetHandler),
  tool("workspace", "delete_widget", deleteWidgetDescription, deleteWidgetSchema, deleteWidgetHandler),
  tool("workspace", "manage_dashboard", manageDashboardDescription, manageDashboardSchema, manageDashboardHandler),
  tool("workspace", "navigate_workspace", navigateWorkspaceDescription, navigateWorkspaceSchema, navigateWorkspaceHandler),
  tool("workspace", "manage_navigation_bar", manageNavigationBarDescription, manageNavigationBarSchema, manageNavigationBarHandler),
  tool("workspace", "create_widget", createWidgetDescription, createWidgetSchema, createWidgetHandler),
  tool("workspace", "update_widget", updateWidgetDescription, updateWidgetSchema, updateWidgetHandler),
  tool("workspace", "update_widget_layout", updateWidgetLayoutDescription, updateWidgetLayoutSchema, updateWidgetLayoutHandler),
  tool("workspace", "add_generative_widget", addGenerativeWidgetDescription, addGenerativeWidgetSchema, addGenerativeWidgetHandler),
  tool("workspace", "get_widget_data", getWidgetDataDescription, getWidgetDataSchema, getWidgetDataHandler),
  tool("workspace", "get_params_options", getParamsOptionsDescription, getParamsOptionsSchema, getParamsOptionsHandler),
  tool("workspace", "assign_tasks_to_agents", assignTasksToAgentsDescription, assignTasksToAgentsSchema, assignTasksToAgentsHandler),
  tool("workspace", "get_skill_content", getSkillContentDescription, getSkillContentSchema, getSkillContentHandler),
  tool("workspace", "manage_backends", manageBackendsDescription, manageBackendsSchema, manageBackendsHandler),
  tool("workspace", "manage_apps", manageAppsDescription, manageAppsSchema, manageAppsHandler),
];

const PROMPT_NAMES = ["workspace_tool_usage", "workspace_session_context"] as const;

function enabled(entry: Tool, features: McpFeatures): boolean {
  if (entry.group === "documents") return features.documents;
  if (entry.group === "workspace") return features.companion;
  return true;
}

function toolNames(features: McpFeatures): Record<"backend" | "workspace", string[]> {
  const names = (group: "backend" | "workspace") =>
    TOOLS.filter((entry) => enabled(entry, features) && (group === "workspace") === (entry.group === "workspace")).map(
      (entry) => entry.name,
    );
  return { backend: names("backend"), workspace: names("workspace") };
}

export async function buildMcpServer(features: McpFeatures): Promise<McpServer> {
  const mcp = new McpServer({
    name: "ines-tools",
    version: "1.0.0",
  });

  for (const entry of TOOLS) {
    if (enabled(entry, features)) entry.register(mcp);
  }

  if (features.companion) {
    registerWorkspacePrompts(mcp);

    await registerAppBuilderResources(mcp);
    registerWidgetsSchemaResource(mcp);
  }

  return mcp;
}

const APP_BUILDER_URI_PREFIX = "workspace://";

export const CORS_ALLOW_HEADERS = [
  "Content-Type",
  "Accept",
  "Authorization",
  "mcp-session-id",
  "mcp-protocol-version",
  "last-event-id",
];

export function createMcpApp(features: McpFeatures, manager: BridgeSessionManager = bridgeManager): Hono {
  const app = new Hono();

  app.use("*", honoLogger);

  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowHeaders: CORS_ALLOW_HEADERS,
      exposeHeaders: ["mcp-session-id"],
    }),
  );

  app.post("/mcp", async (c) => {
    const mcp = await buildMcpServer(features);
    const transport = new StreamableHTTPTransport();
    await mcp.connect(transport);
    return transport.handleRequest(c);
  });
  app.on(["GET", "DELETE"], "/mcp", (c) =>
    c.json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }, 405),
  );

  mountBridgeRoutes(app, manager);

  app.get("/", (c) =>
    c.json({
      name: "ines-mcp-tools",
      version: "1.0.0",
      endpoint: "/mcp",
      bridge_endpoints: {
        session_start: "/bridge/session/start",
        websocket: "/bridge/ws",
        health: "/bridge/health",
      },
      tools: toolNames(features),
      companion_tools_enabled: features.companion,
      prompts: features.companion ? [...PROMPT_NAMES] : [],
      resources: features.companion
        ? { app_builder: { count: listAppBuilderResourceUris().length, uri_prefix: APP_BUILDER_URI_PREFIX } }
        : {},
    }),
  );

  return app;
}
