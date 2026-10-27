/**
 * Bridge HTTP + WebSocket routes for the ines MCP server.
 *
 * - POST /bridge/session/start: mints session_id + token, returns WS URL
 * - GET  /bridge/ws:            WebSocket upgrade for the FINOS Workspace tab
 * - GET  /bridge/health:        liveness + counts (sessions, pending commands)
 *
 * StreamableHTTPTransport handles `/mcp` separately and does not consume
 * `/bridge/ws` upgrade frames — paths are independent in Hono's router.
 */

import { upgradeWebSocket } from "@hono/node-server";
import type { Hono } from "hono";

import { getLogger } from "../lib/logger.ts";
import {
  BrowserSessionStartRequestSchema,
  type BrowserSessionStartResponse,
} from "./types.ts";
import {
  BrowserUnavailableError,
  type BridgeSessionManager,
  type BridgeSocket,
} from "./state.ts";

const logger = getLogger(["mcp", "bridge", "routes"]);

/** The WebSocket upgrades are served by the server's WebSocketServer (mcp-server/src/server.ts). */
export function mountBridgeRoutes(app: Hono, manager: BridgeSessionManager): void {
  app.post("/bridge/session/start", async (c) => {
    let body: unknown = {};
    try {
      body = await c.req.json();
    } catch {
      // Empty body OK — schema fills in defaults.
    }
    const parsed = BrowserSessionStartRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: {
            code: "invalid_request",
            message: "Invalid session start request.",
            details: { issues: parsed.error.issues.slice(0, 3) },
          },
        },
        400,
      );
    }
    const out: BrowserSessionStartResponse = manager.startSession(parsed.data);
    return c.json(out);
  });

  app.get(
    "/bridge/ws",
    upgradeWebSocket((c) => {
      const sessionId = c.req.query("session_id") ?? "";
      const token = c.req.query("token") ?? "";

      return {
        onOpen(_evt, ws) {
          const socket: BridgeSocket = {
            send: (data) => ws.send(data),
            close: (code, reason) => ws.close(code, reason),
          };
          try {
            const session = manager.connectBrowser({
              sessionId,
              token,
              socket,
            });
            ws.send(
              JSON.stringify({ type: "session_ready", session }),
            );
          } catch (err) {
            const msg =
              err instanceof BrowserUnavailableError
                ? err.message
                : "Bridge connection rejected.";
            ws.send(
              JSON.stringify({
                type: "error",
                error: {
                  code: "unauthorized",
                  message: msg,
                  retryable: false,
                },
              }),
            );
            ws.close(1008, "unauthorized");
          }
        },

        onMessage(evt) {
          const text =
            typeof evt.data === "string"
              ? evt.data
              : evt.data instanceof ArrayBuffer
                ? new TextDecoder().decode(evt.data)
                : String(evt.data);
          let parsed: unknown;
          try {
            parsed = JSON.parse(text);
          } catch {
            logger.warn("Bridge received non-JSON message", {
              sessionId,
              preview: text.slice(0, 120),
            });
            return;
          }
          manager.handleBrowserMessage(sessionId, parsed);
        },

        onClose() {
          manager.disconnectBrowser({ sessionId });
        },

        onError(evt) {
          logger.error("Bridge WebSocket error", {
            sessionId,
            error: String(evt),
          });
          manager.disconnectBrowser({ sessionId });
        },
      };
    }),
  );

  app.get("/bridge/health", (c) => c.json(manager.health()));
}
