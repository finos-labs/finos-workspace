/**
 * Widget data through the FINOS Workspace's MCP tool.
 *
 * The FINOS Workspace serves its own MCP server (`get_widget_data`, among its tools). When that tool is in the
 * request's tools, it is how Ines reads a widget (see `makeMcpTools`): the model calls the tool with the
 * schema and the description that the server gives it, the browser runs it through the FINOS Workspace's bridge
 * (and through the iframe bridge, for the page of an iframe widget), and the result comes back as the result
 * of any MCP tool. This reads that result as what the rest of the agent knows how to take in: the tool
 * message of a `get_widget_data` round trip, whose data is turned into queryable tables.
 */

import type { ToolMessage, Widget } from "../protocol/types.ts";
import { getLogger } from "../lib/logger.ts";

const logger = getLogger(["app", "agent", "workspace-widget-data"]);

/** The name the model knows the tool by, and the canonical name on the FINOS Workspace's server. */
export const WIDGET_DATA_TOOL = "get_widget_data";

/** A tool by its canonical name, whichever the FINOS Workspace calls it by (it may put the server in front: `Workspace_get_widget_data`). */
export function isWidgetDataToolName(name: unknown): boolean {
  return typeof name === "string" && (name === WIDGET_DATA_TOOL || name.endsWith(`_${WIDGET_DATA_TOOL}`));
}

/** Whether a tool message is the result of the FINOS Workspace's MCP `get_widget_data` (as an `execute_agent_tool` round trip). */
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

/**
 * The result of the tool, whatever the browser wrapped it in: the browser hands the text content of an MCP
 * result to the agent as one JSON string, which is a list of the text items (each the tool's JSON result),
 * or the result itself.
 */
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

/**
 * The tool message of a `get_widget_data` round trip that the MCP result stands for, or null when it
 * is not one that carries data (the tool failed, or the browser had no answer): that result is the model's to
 * read as it is, like the result of any tool.
 */
export function asWidgetDataMessage(toolMsg: ToolMessage, allWidgets: Widget[]): ToolMessage | null {
  if (!isWidgetDataMcpResult(toolMsg)) return null;
  const result = toolResult(toolMsg);
  if (!result || result.ok !== true || !Array.isArray(result.data)) return null;

  const parameters = asRecord(toolMsg.input_arguments?.parameters) ?? {};
  const origin = typeof parameters.origin === "string" ? parameters.origin : "";
  const id = typeof parameters.widget_id === "string" ? parameters.widget_id : "";
  const args = asRecord(parameters.data_args) ?? {};
  // The tool takes the widget's uuid as an option; without it the widget is the one that has this origin and id.
  // A file attached to the chat has the uuid `file-<stored file uuid>`, and a model may name it by the stored
  // file's uuid alone.
  const named = typeof parameters.widget_uuid === "string" ? parameters.widget_uuid : "";
  const widgetUuid =
    (named &&
      (allWidgets.find((widget) => widget.uuid === named) ??
        allWidgets.find((widget) => widget.widget_id === `file-${named}`))?.uuid) ||
    allWidgets.find((widget) => widget.origin === origin && widget.widget_id === id)?.uuid ||
    named ||
    undefined;
  if (!widgetUuid) logger.warn("A widget-data result names no widget that is known", { origin, id });

  // The browser hands the rows over as data; the tool message of a round trip has them as the JSON text the
  // widget parsers read.
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
