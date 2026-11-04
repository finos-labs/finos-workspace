import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { bridgeManager } from "../bridge/singleton.ts";
import { SERVER_INSTRUCTIONS } from "../bridge/instructions.ts";

function sessionContextPromptContent(): string {
  const sessionId = bridgeManager.getFirstConnectedSessionId();
  if (sessionId === null) {
    return "No FINOS Workspace browser session context is currently available.";
  }
  const ctx = bridgeManager.getSessionContext(sessionId);
  if (ctx === null) {
    return "No FINOS Workspace browser session context is currently available.";
  }
  const dashboardId = ctx.current_dashboard_id ?? "none";
  const tabId = ctx.current_tab_id ?? "none";
  return (
    "Current FINOS Workspace browser session context: " +
    `current_dashboard_id=${dashboardId}; ` +
    `current_tab_id=${tabId}.`
  );
}

export function registerWorkspacePrompts(mcp: McpServer): void {
  mcp.registerPrompt(
    "workspace_tool_usage",
    {
      description:
        "Generic guidance for using the FINOS Workspace MCP tool surface.",
    },
    () => ({
      messages: [
        {
          role: "user",
          content: { type: "text", text: SERVER_INSTRUCTIONS },
        },
        {
          role: "user",
          content: { type: "text", text: sessionContextPromptContent() },
        },
      ],
    }),
  );

  mcp.registerPrompt(
    "workspace_session_context",
    {
      description: "Current tracked FINOS Workspace dashboard and tab context.",
    },
    () => ({
      messages: [
        {
          role: "user",
          content: { type: "text", text: sessionContextPromptContent() },
        },
      ],
    }),
  );
}
