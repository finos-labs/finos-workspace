/**
 * get_widget_data — fetch one widget's runtime data via the browser bridge.
 *
 * Mirrors workspace_mcp/server.py:507-539. data_args_json arrives as a
 * JSON-string arg; the wire shape uses Ada vocabulary
 * (origin, id, input_args) so we translate via dataSourcePayloads.
 */

import { z } from "zod";
import type { ContentItem } from "../../lib/typed.ts";
import { bridgeManager } from "../../bridge/singleton.ts";
import { executeBridgeCommand } from "../../bridge/execute.ts";
import { parseJsonObject, JsonArgumentError } from "../../bridge/json-args.ts";
import { dataSourcePayloads } from "../../bridge/translate.ts";
import { describeTool, DATA_SOURCE_SHAPE } from "../../bridge/instructions.ts";

export const getWidgetDataSchema = {
  origin: z.string().describe(
    "Friendly catalog label (matches list_available_widgets).",
  ),
  widget_id: z.string().describe("Widget id from list_available_widgets."),
  data_args_json: z.string().optional().describe(
    "JSON object string of widget data inputs (params).",
  ),
  widget_uuid: z.string().optional().describe(
    "Optional canonical widget instance UUID.",
  ),
} as const;

export const getWidgetDataDescription = describeTool(
  "Fetch current data for one or more Workspace data sources.",
  DATA_SOURCE_SHAPE,
  "Only use this after selecting an exact widget identity and explicit data_args.",
);

export async function getWidgetDataHandler(args: {
  origin: string;
  widget_id: string;
  data_args_json?: string;
  widget_uuid?: string;
}): Promise<{ content: ContentItem[] }> {
  let dataArgs: Record<string, unknown>;
  try {
    dataArgs = parseJsonObject("get_widget_data", "data_args_json", args.data_args_json);
  } catch (err) {
    if (err instanceof JsonArgumentError) {
      return { content: [err.toContentItem()] };
    }
    throw err;
  }

  const dataSources = dataSourcePayloads([
    {
      origin: args.origin,
      widget_id: args.widget_id,
      data_args: dataArgs,
      widget_uuid: args.widget_uuid ?? null,
    },
  ]);

  const { content } = await executeBridgeCommand(bridgeManager, {
    command: "get_widget_data",
    data_sources: dataSources,
  });
  return { content };
}
