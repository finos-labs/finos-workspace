import type { ToolMessage, Widget } from "../protocol/types.ts";
import { getLogger } from "../lib/logger.ts";

const logger = getLogger(["app", "agent", "workspace-widget-data"]);

export const WIDGET_DATA_TOOL = "get_widget_data";

export function isWidgetDataToolName(name: unknown): boolean {
  return typeof name === "string" && (name === WIDGET_DATA_TOOL || name.endsWith(`_${WIDGET_DATA_TOOL}`));
}

export function isWidgetDataMcpResult(toolMsg: ToolMessage): boolean {
  return toolMsg.function === "execute_agent_tool" && isWidgetDataToolName(toolMsg.input_arguments?.tool_name);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function toolResult(toolMsg: ToolMessage): Record<string, unknown> | null {
  const items = asRecord(toolMsg.data?.[0])?.items;
  if (!Array.isArray(items)) return null;
  for (const item of items) {
    const content = asRecord(item)?.content;
    const value = typeof content === "string" ? parseJson(content) : content;
    const candidates = Array.isArray(value) ? value : [value];
    for (const candidate of candidates) {
      const result = asRecord(typeof candidate === "string" ? parseJson(candidate) : candidate);
      if (result && "ok" in result) return result;
    }
  }
  return null;
}

export function asWidgetDataMessage(toolMsg: ToolMessage, allWidgets: Widget[]): ToolMessage | null {
  if (!isWidgetDataMcpResult(toolMsg)) return null;
  const result = toolResult(toolMsg);
  if (!result || result.ok !== true || !Array.isArray(result.data)) return null;

  const parameters = asRecord(toolMsg.input_arguments?.parameters) ?? {};
  const origin = typeof parameters.origin === "string" ? parameters.origin : "";
  const id = typeof parameters.widget_id === "string" ? parameters.widget_id : "";
  const args = asRecord(parameters.data_args) ?? {};
  const named = typeof parameters.widget_uuid === "string" ? parameters.widget_uuid : "";
  const widgetUuid =
    (named &&
      (allWidgets.find((widget) => widget.uuid === named) ??
        allWidgets.find((widget) => widget.widget_id === `file-${named}`))?.uuid) ||
    allWidgets.find((widget) => widget.origin === origin && widget.widget_id === id)?.uuid ||
    named ||
    undefined;
  if (!widgetUuid) logger.warn("A widget-data result names no widget that is known", { origin, id });

  const data = (result.data as unknown[]).map((entry) => {
    const record = asRecord(entry) ?? {};
    const items = Array.isArray(record.items) ? record.items : [];
    return {
      ...record,
      items: items.map((item) => {
        const itemRecord = asRecord(item);
        if (!itemRecord || typeof itemRecord.content === "string" || itemRecord.content === undefined) return item;
        return { ...itemRecord, content: JSON.stringify(itemRecord.content) };
      }),
    };
  });

  return {
    ...toolMsg,
    function: WIDGET_DATA_TOOL,
    input_arguments: { data_sources: [{ ...(widgetUuid ? { widget_uuid: widgetUuid } : {}), origin, id, input_args: args }] },
    data: data as ToolMessage["data"],
  };
}
