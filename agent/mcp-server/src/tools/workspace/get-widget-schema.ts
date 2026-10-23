/**
 * get_widget_schema — fetch one widget's params + UI schema.
 *
 * Pre-validates that origin and widget_id are present (mirrors
 * workspace_mcp/server.py:581-585 invalid_request guard).
 */

import { z } from "zod";
import type { ContentItem } from "../../lib/typed.ts";
import { bridgeManager } from "../../bridge/singleton.ts";
import { executeBridgeCommand } from "../../bridge/execute.ts";

export const getWidgetSchemaSchema = {
  origin: z
    .string()
    .min(1)
    .describe("Friendly catalog label from list_available_widgets."),
  widget_id: z
    .string()
    .min(1)
    .describe("Widget id from list_available_widgets."),
} as const;

export const getWidgetSchemaDescription =
  "Fetch the exact schema for one available widget. " +
  "Returns deterministic params and UI inputs to use in subsequent create_widget / update_widget calls. " +
  "Requires origin and widget_id from list_available_widgets — caller must select before calling. " +
  "data_args_schema and ui_args_schema are closed JSON Schemas for the data_args and ui_args of create_widget " +
  "and update_widget: a ui_args key or value they do not accept refuses the call, and a data_args value they " +
  "do not accept is ignored with a warning. " +
  "method is the widget's HTTP method, and each param's in says where its value goes in the widget's request: " +
  "path, query, header or body. " +
  "mcp_tool, when present, names the MCP tool of the widget's own backend that queries what the widget shows, " +
  "and how its params fill the tool's arguments.";

export async function getWidgetSchemaHandler(args: {
  origin: string;
  widget_id: string;
}): Promise<{ content: ContentItem[] }> {
  const { content } = await executeBridgeCommand(bridgeManager, {
    command: "get_widget_schema",
    origin: args.origin,
    widget_id: args.widget_id,
  });
  return { content };
}
