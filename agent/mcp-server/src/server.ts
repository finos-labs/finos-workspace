import "./lib/logger";
import { honoLogger, getLogger } from "./lib/logger";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import {
  webSearchSchema,
  webSearchHandler,
  webSearchDescription,
} from "./tools/backend/web-search";
import {
  fetchWebpageSchema,
  fetchWebpageHandler,
  fetchWebpageDescription,
} from "./tools/backend/fetch-webpage";
import {
  inspectWebpageSchema,
  inspectWebpageHandler,
  inspectWebpageDescription,
} from "./tools/backend/inspect-webpage";
import {
  queryDocumentsSchema,
  queryDocumentsHandler,
  queryDocumentsDescription,
} from "./tools/backend/documents/query-documents";
import {
  listDocumentsSchema,
  listDocumentsHandler,
  listDocumentsDescription,
} from "./tools/backend/documents/list-documents";
import { embeddingProblem } from "./tools/backend/documents/retrieve";
import { observed } from "./lib/observe";
import { requireScope, scopeSecretProblem } from "./lib/scope-check";
import { renderMetrics } from "../../src/lib/metrics";
import { configureFetchPolicy } from "../../src/lib/safe-fetch";
import { mountBridgeRoutes } from "./bridge/routes";
import { bridgeManager } from "./bridge/singleton";
import { registerWorkspacePrompts } from "./prompts/workspace";
import { registerAppBuilderResources } from "./resources/app-builder";
import {
  getWorkspaceSnapshotSchema,
  getWorkspaceSnapshotHandler,
  getWorkspaceSnapshotDescription,
} from "./tools/workspace/get-workspace-snapshot";
import {
  listAvailableWidgetsSchema,
  listAvailableWidgetsHandler,
  listAvailableWidgetsDescription,
} from "./tools/workspace/list-available-widgets";
import {
  getWidgetSchemaSchema,
  getWidgetSchemaHandler,
  getWidgetSchemaDescription,
} from "./tools/workspace/get-widget-schema";
import {
  readWidgetSchema,
  readWidgetHandler,
  readWidgetDescription,
} from "./tools/workspace/read-widget";
import {
  deleteWidgetSchema,
  deleteWidgetHandler,
  deleteWidgetDescription,
} from "./tools/workspace/delete-widget";
import {
  manageDashboardSchema,
  manageDashboardHandler,
  manageDashboardDescription,
} from "./tools/workspace/manage-dashboard";
import {
  navigateWorkspaceSchema,
  navigateWorkspaceHandler,
  navigateWorkspaceDescription,
} from "./tools/workspace/navigate-workspace";
import {
  manageNavigationBarSchema,
  manageNavigationBarHandler,
  manageNavigationBarDescription,
} from "./tools/workspace/manage-navigation-bar";
import {
  createWidgetSchema,
  createWidgetHandler,
  createWidgetDescription,
} from "./tools/workspace/create-widget";
import {
  updateWidgetSchema,
  updateWidgetHandler,
  updateWidgetDescription,
} from "./tools/workspace/update-widget";
import {
  updateWidgetLayoutSchema,
  updateWidgetLayoutHandler,
  updateWidgetLayoutDescription,
} from "./tools/workspace/update-widget-layout";
import {
  addGenerativeWidgetSchema,
  addGenerativeWidgetHandler,
  addGenerativeWidgetDescription,
} from "./tools/workspace/add-generative-widget";
import {
  getWidgetDataSchema,
  getWidgetDataHandler,
  getWidgetDataDescription,
} from "./tools/workspace/get-widget-data";
import {
  getParamsOptionsSchema,
  getParamsOptionsHandler,
  getParamsOptionsDescription,
} from "./tools/workspace/get-params-options";
import {
  assignTasksToAgentsSchema,
  assignTasksToAgentsHandler,
  assignTasksToAgentsDescription,
} from "./tools/workspace/assign-tasks-to-agents";
import {
  getSkillContentSchema,
  getSkillContentHandler,
  getSkillContentDescription,
} from "./tools/workspace/get-skill-content";
import {
  manageBackendsSchema,
  manageBackendsHandler,
  manageBackendsDescription,
} from "./tools/workspace/manage-backends";
import {
  manageAppsSchema,
  manageAppsHandler,
  manageAppsDescription,
} from "./tools/workspace/manage-apps";

const logger = getLogger(["mcp", "server"]);

// What keeps one user's chat from another: the scope key of every call that reaches a tool holding state
// for a chat is signed by the agent with this secret, and these tools act on no other. A server that ran
// without it would take any key a client sent, so it does not start without it (INES_AUTH=none, the
// deployment that has no users, is the named opt-out — the same one the agent takes).
//
// Only when this file is the process, which is how it is served (see the Dockerfile): a test that imports
// it for its `fetch` is not a server starting, and stopping the process would stop the test run. Such a
// server would in any case refuse every scoped call, because `scopeProblem` makes the same judgement.
if (import.meta.main) {
  const secretProblem = scopeSecretProblem();
  if (secretProblem) {
    logger.fatal(secretProblem);
    process.exit(1);
  }
}

// The Workspace's links to its users' files are on the address the browser uses; these tools fetch them from
// the API's address inside the deployment (see src/lib/safe-fetch.ts), with WORKSPACE_ORIGIN as their Origin:
// the API refuses the calls of an origin it does not allow. Without WORKSPACE_PUBLIC_URL a link is fetched as
// it is.
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

// Which tools exist is decided once, at start, and said once. Each request then gets a server
// that registers exactly these (see `buildMcpServer`).

// Document RAG — uploaded PDF/DOCX/TXT/MD search via per-conversation
// vector store. Needs INES_EMBED_MODEL to name the embedding model as
// <provider>:<model> (no model id is baked in) and that provider's credentials,
// so the tools are only registered when both are in place.
const embedProblem = embeddingProblem();
const docRagEnabled = embedProblem === null;
if (!docRagEnabled) {
  logger.warn(`${embedProblem} query_documents/list_documents disabled (embeddings unavailable)`);
}

// Workspace bridge (companion) tools — require a Workspace browser
// tab connected to /bridge/ws. Behind COMPANION_TOOLS_ENABLED (default off)
// so a plain backend-tools deployment doesn't advertise 18 tools that need
// a connected browser. Prompts and app-builder resources only describe
// these tools, so they're gated together.
const companionToolsEnabled = process.env.COMPANION_TOOLS_ENABLED === "true";
if (!companionToolsEnabled) {
  logger.warn(
    "COMPANION_TOOLS_ENABLED not set to 'true' — workspace bridge tools, prompts, and app-builder resources disabled",
  );
}

/**
 * A server with every tool that is enabled. One is built per request: a server and its transport
 * keep the JSON-RPC ids of the requests in flight, and every client counts its ids from the same
 * start, so one shared by all clients mixes up their answers.
 */
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

  // Read-widget-data SQL family lives in the agent now (in-process,
  // closure on pendingTables). It's no longer registered here.

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

    // Workspace MCP prompts (workspace_tool_usage + workspace_session_context).
    registerWorkspacePrompts(mcp);

    // App-builder MCP resources (16 markdown documents under workspace://*).
    await registerAppBuilderResources(mcp);
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

// Stateless: every request is answered by its own server and transport, and there is no session to
// resume and no stream from the server to the client.
app.post("/mcp", async (c) => {
  const mcp = await buildMcpServer();
  const transport = new StreamableHTTPTransport();
  await mcp.connect(transport);
  return transport.handleRequest(c);
});
app.on(["GET", "DELETE"], "/mcp", (c) =>
  c.json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }, 405),
);

const { websocket } = mountBridgeRoutes(app, bridgeManager);

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

// Prometheus scrapes this on its own port (MCP_METRICS_PORT, 9465 unless set; 0 turns it off), which is
// not published: the metrics are for the operator. Only when this file is the program that runs.
const METRICS_PORT = Number(process.env.MCP_METRICS_PORT ?? 9465);
if (import.meta.main && METRICS_PORT > 0) {
  Bun.serve({
    port: METRICS_PORT,
    fetch(request) {
      return new URL(request.url).pathname === "/metrics"
        ? new Response(renderMetrics(), { headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" } })
        : new Response("Not found", { status: 404 });
    },
  });
  logger.info("Metrics on port {port}", { port: METRICS_PORT });
}

export default {
  fetch: app.fetch,
  port: PORT,
  idleTimeout: 255,
  websocket,
};

logger.info(
  `MCP server starting port=${PORT} docRagEnabled=${docRagEnabled} companionToolsEnabled=${companionToolsEnabled} bridgeMounted=true`,
);
