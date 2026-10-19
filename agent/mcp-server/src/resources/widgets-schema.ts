/**
 * `workspace://specs/widgets-json-schema`: the JSON Schema a backend's widgets.json is validated against for
 * the signed-in user, with the plugin types enabled for their organization (docs/widget-plugins/WIDGETS-JSON.md
 * 3.9). It is read from the connected Workspace browser when it is asked for, as the resource of the same URI in
 * backend-api/backend/workspace_mcp/server/__init__.py is.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { bridgeManager } from "../bridge/singleton";
import type { BridgeSessionManager } from "../bridge/state";

export const WIDGETS_JSON_SCHEMA_URI = "workspace://specs/widgets-json-schema";
const MIME_TYPE = "application/schema+json";

type SchemaSource = Pick<BridgeSessionManager, "getFirstConnectedSessionId" | "executeCommand">;

export function registerWidgetsSchemaResource(mcp: McpServer, manager: SchemaSource = bridgeManager): void {
  mcp.registerResource(
    "widgets.json JSON Schema",
    WIDGETS_JSON_SCHEMA_URI,
    {
      description:
        "The JSON Schema a backend's widgets.json is validated against for the signed-in user: the built-in " +
        "types and the plugin types enabled for their organization, every key and value closed. Read from the " +
        "user's Workspace session, so it needs the browser connected.",
      mimeType: MIME_TYPE,
    },
    async () => {
      const sessionId = manager.getFirstConnectedSessionId();
      if (!sessionId) {
        throw new Error(
          "No connected Workspace browser. Open the workspace and connect the bridge before reading this resource.",
        );
      }
      const result = await manager.executeCommand(sessionId, { command: "get_widgets_schema" });
      if (!result.ok) throw new Error(result.message);
      const schema = (result.data as { schema?: unknown } | null | undefined)?.schema;
      return { contents: [{ uri: WIDGETS_JSON_SCHEMA_URI, mimeType: MIME_TYPE, text: JSON.stringify(schema) }] };
    },
  );
}
