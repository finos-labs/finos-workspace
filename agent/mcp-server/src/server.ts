import "./lib/logger.ts";
import { getLogger } from "./lib/logger.ts";
import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { renderMetrics } from "../../src/lib/metrics.ts";
import { configureFetchPolicy } from "../../src/lib/safe-fetch.ts";
import { createMcpApp } from "./app.ts";
import { scopeSecretProblem } from "./lib/scope-check.ts";
import { embeddingProblem } from "./tools/backend/documents/retrieve.ts";

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
      "WORKSPACE_ORIGIN is required with WORKSPACE_PUBLIC_URL: the web app's origin, which the FINOS Workspace API allows (BACKEND_CORS_ORIGINS), like https://workspace.example.com",
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

const app = createMcpApp({ documents: docRagEnabled, companion: companionToolsEnabled });

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
