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

export function mountBridgeRoutes(app: Hono, manager: BridgeSessionManager): void {
  app.post("/bridge/session/start", async (c) => {
    let body: unknown = {};
    try {
      body = await c.req.json();
    } catch {
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
