import { z } from "zod";
import type { ContentItem } from "../../lib/typed.ts";
import { bridgeManager } from "../../bridge/singleton.ts";
import { executeBridgeCommand } from "../../bridge/execute.ts";
import { invalidRequestItem, hasLayoutUiArgs } from "../../bridge/validators.ts";
import { parseJsonObject, JsonArgumentError } from "../../bridge/json-args.ts";
import {
  describeTool,
  WIDGET_INSTANCE_GUIDANCE,
  LAYOUT_GUIDANCE,
  DASHBOARD_TARGETING_GUIDANCE,
} from "../../bridge/instructions.ts";

export const updateWidgetSchema = {
  widget_uuid: z.string().optional().describe(
    "Canonical widget instance identifier from a workspace snapshot.",
  ),
  widget_id: z.string().optional().describe(
    "Fallback widget type identifier when uuid is unknown.",
  ),
  dashboard_id: z.string().optional().describe(
    "Target dashboard UUID. Omit to target the current FINOS Workspace route.",
  ),
  data_args_json: z.string().optional().describe(
    "JSON object string of widget data inputs, as data_args_schema from get_widget_schema defines them.",
  ),
  ui_args_json: z.string().optional().describe(
    "JSON object string of widget UI inputs, as ui_args_schema from get_widget_schema defines them. Layout fields rejected — use update_widget_layout.",
  ),
} as const;

export const updateWidgetDescription = describeTool(
  "Update one widget's config on a target dashboard.",
  WIDGET_INSTANCE_GUIDANCE,
  DASHBOARD_TARGETING_GUIDANCE,
  LAYOUT_GUIDANCE,
);

export async function updateWidgetHandler(args: {
  widget_uuid?: string;
  widget_id?: string;
  dashboard_id?: string;
  data_args_json?: string;
  ui_args_json?: string;
}): Promise<{ content: ContentItem[] }> {
  let dataArgs: Record<string, unknown>;
  let uiArgs: Record<string, unknown>;
  try {
    dataArgs = parseJsonObject("update_widget", "data_args_json", args.data_args_json);
    uiArgs = parseJsonObject("update_widget", "ui_args_json", args.ui_args_json);
  } catch (err) {
    if (err instanceof JsonArgumentError) {
      return { content: [err.toContentItem()] };
    }
    throw err;
  }

  if (hasLayoutUiArgs(uiArgs)) {
    return {
      content: [
        invalidRequestItem(
          "update_widget does not accept layout fields (x/y/w/h/min_w/grid_data/inner_tab/etc.). " +
            "Use update_widget_layout for those.",
        ),
      ],
    };
  }

  const config = {
    data_args: Object.keys(dataArgs).length > 0 ? dataArgs : null,
    ui_args: Object.keys(uiArgs).length > 0 ? uiArgs : null,
  };

  const { content } = await executeBridgeCommand(bridgeManager, {
    command: "update_widget",
    widget_uuid: args.widget_uuid ?? null,
    widget_id: args.widget_id ?? null,
    dashboard_id: args.dashboard_id ?? null,
    config,
  });
  return { content };
}
