import "./lib/logger.ts";
import { honoLogger, getLogger } from "./lib/logger.ts";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { WebSocketServer } from "ws";
import { cors } from "hono/cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
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
import { embeddingProblem } from "./tools/backend/documents/retrieve.ts";
import { observed } from "./lib/observe.ts";
import { requireScope, scopeSecretProblem } from "./lib/scope-check.ts";
import { renderMetrics } from "../../src/lib/metrics.ts";
import { configureFetchPolicy } from "../../src/lib/safe-fetch.ts";
import { mountBridgeRoutes } from "./bridge/routes.ts";
import { bridgeManager } from "./bridge/singleton.ts";
import { registerWorkspacePrompts } from "./prompts/workspace.ts";
import { registerAppBuilderResources } from "./resources/app-builder.ts";
import { registerWidgetsSchemaResource } from "./resources/widgets-schema.ts";
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

const logger = getLogger(["mcp", "server"]);

if (import.meta.main) {
  const secretProblem = scopeSecretProblem();
  if (secretProblem) {
    logger.fatal(secretProblem);
    process.exit(1);
  }
}

const workspacePublicUrl = (process.env.WORKSPACE_PUBLIC_URL ?? "").trim().replace(/\/+$/, "");
if (workspacePublicUrl) {
  const internalUrl = (process.env.WORKSPACE_API_URL ?? "").trim().replace(/\/+$/, "") || workspacePublicUrl;
  const origin = (process.env.WORKSPACE_ORIGIN ?? "").trim().replace(/\/+$/, "");
  try {
    new URL(workspacePublicUrl);
    new URL(internalUrl);
  } catch {
    logger.fatal("WORKSPACE_PUBLIC_URL and WORKSPACE_API_URL must be URLs like http://api:8000");
    process.exit(1);
  }
  let isOrigin = false;
  try {
    isOrigin = new URL(origin).origin === origin;
  } catch {}
  if (!isOrigin) {
    logger.fatal(
      "WORKSPACE_ORIGIN is required with WORKSPACE_PUBLIC_URL: the web app's origin, which the Workspace API allows (BACKEND_CORS_ORIGINS), like https://workspace.example.com",
    );
    process.exit(1);
  }
  configureFetchPolicy({ workspace: { publicUrl: workspacePublicUrl, internalUrl, origin } });
}


const embedProblem = embeddingProblem();
const docRagEnabled = embedProblem === null;
if (!docRagEnabled) {
  logger.warn(`${embedProblem} query_documents/list_documents disabled (embeddings unavailable)`);
}

const companionToolsEnabled = process.env.COMPANION_TOOLS_ENABLED === "true";
if (!companionToolsEnabled) {
  logger.warn(
    "COMPANION_TOOLS_ENABLED not set to 'true' — workspace bridge tools, prompts, and app-builder resources disabled",
  );
}

async function buildMcpServer(): Promise<McpServer> {
  const mcp = new McpServer({
    name: "ines-tools",
    version: "1.0.0",
  });

  mcp.tool("web_search", webSearchDescription, webSearchSchema, observed("web_search", webSearchHandler));
  mcp.tool("fetch_webpage", fetchWebpageDescription, fetchWebpageSchema, observed("fetch_webpage", fetchWebpageHandler));
  mcp.tool(
    "inspect_webpage",
    inspectWebpageDescription,
    inspectWebpageSchema,
    observed("inspect_webpage", requireScope(inspectWebpageHandler)),
  );


  if (docRagEnabled) {
    mcp.tool(
      "query_documents",
      queryDocumentsDescription,
      queryDocumentsSchema,
      observed("query_documents", requireScope(queryDocumentsHandler)),
    );
    mcp.tool(
      "list_documents",
      listDocumentsDescription,
      listDocumentsSchema,
      observed("list_documents", requireScope(listDocumentsHandler)),
    );
  }
  if (companionToolsEnabled) {
    mcp.tool(
      "get_workspace_snapshot",
      getWorkspaceSnapshotDescription,
      getWorkspaceSnapshotSchema,
      getWorkspaceSnapshotHandler,
    );
    mcp.tool(
      "list_available_widgets",
      listAvailableWidgetsDescription,
      listAvailableWidgetsSchema,
      listAvailableWidgetsHandler,
    );
    mcp.tool(
      "get_widget_schema",
      getWidgetSchemaDescription,
      getWidgetSchemaSchema,
      getWidgetSchemaHandler,
    );
    mcp.tool("read_widget", readWidgetDescription, readWidgetSchema, readWidgetHandler);
    mcp.tool("delete_widget", deleteWidgetDescription, deleteWidgetSchema, deleteWidgetHandler);
    mcp.tool(
      "manage_dashboard",
      manageDashboardDescription,
      manageDashboardSchema,
      manageDashboardHandler,
    );
    mcp.tool(
      "navigate_workspace",
      navigateWorkspaceDescription,
      navigateWorkspaceSchema,
      navigateWorkspaceHandler,
    );
    mcp.tool(
      "manage_navigation_bar",
      manageNavigationBarDescription,
      manageNavigationBarSchema,
      manageNavigationBarHandler,
    );
    mcp.tool(
      "create_widget",
      createWidgetDescription,
      createWidgetSchema,
      createWidgetHandler,
    );
    mcp.tool(
      "update_widget",
      updateWidgetDescription,
      updateWidgetSchema,
      updateWidgetHandler,
    );
    mcp.tool(
      "update_widget_layout",
      updateWidgetLayoutDescription,
      updateWidgetLayoutSchema,
      updateWidgetLayoutHandler,
    );
    mcp.tool(
      "add_generative_widget",
      addGenerativeWidgetDescription,
      addGenerativeWidgetSchema,
      addGenerativeWidgetHandler,
    );
    mcp.tool(
      "get_widget_data",
      getWidgetDataDescription,
      getWidgetDataSchema,
      getWidgetDataHandler,
    );
    mcp.tool(
      "get_params_options",
      getParamsOptionsDescription,
      getParamsOptionsSchema,
      getParamsOptionsHandler,
    );
    mcp.tool(
      "assign_tasks_to_agents",
      assignTasksToAgentsDescription,
      assignTasksToAgentsSchema,
      assignTasksToAgentsHandler,
    );
    mcp.tool(
      "get_skill_content",
      getSkillContentDescription,
      getSkillContentSchema,
      getSkillContentHandler,
    );
    mcp.tool(
      "manage_backends",
      manageBackendsDescription,
      manageBackendsSchema,
      manageBackendsHandler,
    );
    mcp.tool(
      "manage_apps",
      manageAppsDescription,
      manageAppsSchema,
      manageAppsHandler,
    );

    registerWorkspacePrompts(mcp);

    await registerAppBuilderResources(mcp);
    registerWidgetsSchemaResource(mcp);
  }

  return mcp;
}

const app = new Hono();

app.use("*", honoLogger);

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Accept",
      "Authorization",
      "mcp-session-id",
      "mcp-protocol-version",
      "last-event-id",
    ],
    exposeHeaders: ["mcp-session-id"],
  }),
);

app.post("/mcp", async (c) => {
  const mcp = await buildMcpServer();
  const transport = new StreamableHTTPTransport();
  await mcp.connect(transport);
  return transport.handleRequest(c);
});
app.on(["GET", "DELETE"], "/mcp", (c) =>
  c.json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }, 405),
);

mountBridgeRoutes(app, bridgeManager);

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
    tools: {
      backend: [
        "web_search",
        "fetch_webpage",
        "inspect_webpage",
        ...(docRagEnabled ? ["query_documents", "list_documents"] : []),
      ],
      workspace: companionToolsEnabled
        ? [
            "get_workspace_snapshot",
            "list_available_widgets",
            "get_widget_schema",
            "read_widget",
            "delete_widget",
            "manage_dashboard",
            "navigate_workspace",
            "manage_navigation_bar",
            "create_widget",
            "update_widget",
            "update_widget_layout",
            "add_generative_widget",
            "get_widget_data",
            "get_params_options",
            "assign_tasks_to_agents",
            "get_skill_content",
            "manage_backends",
            "manage_apps",
          ]
        : [],
    },
    companion_tools_enabled: companionToolsEnabled,
    prompts: companionToolsEnabled
      ? ["workspace_tool_usage", "workspace_session_context"]
      : [],
    resources: companionToolsEnabled
      ? { app_builder: { count: 16, uri_prefix: "workspace://" } }
      : {},
  }),
);

const PORT = Number(process.env.MCP_PORT ?? 8787);

const METRICS_PORT = Number(process.env.MCP_METRICS_PORT ?? 9465);
if (import.meta.main && METRICS_PORT > 0) {
  serve({
    port: METRICS_PORT,
    fetch(request) {
      return new URL(request.url).pathname === "/metrics"
        ? new Response(renderMetrics(), { headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" } })
        : new Response("Not found", { status: 404 });
    },
  });
  logger.info("Metrics on port {port}", { port: METRICS_PORT });
}

if (import.meta.main) {
  serve({ fetch: app.fetch, port: PORT, websocket: { server: new WebSocketServer({ noServer: true }) } });
  logger.info(
    `MCP server starting port=${PORT} docRagEnabled=${docRagEnabled} companionToolsEnabled=${companionToolsEnabled} bridgeMounted=true`,
  );
}

export default { fetch: app.fetch };
