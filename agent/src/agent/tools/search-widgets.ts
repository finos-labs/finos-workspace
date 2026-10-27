import { tool } from "ai";
import { z } from "zod";
import type { Widget } from "../../protocol/types.ts";
import { searchWidgets, type TieredWidget, type WidgetTier } from "../../widgets/tiers.ts";
import { getLogger } from "../../lib/logger.ts";
import { displaySummarySchema } from "./progress.ts";

const logger = getLogger(["app", "tools", "search_widgets"]);

export const SEARCH_RESULT_CAP = 100;

export const searchWidgetsSchema = z.object({
  display_summary: displaySummarySchema,
  query: z.string().describe("Keywords from the user's question, or \"\" to list every widget."),
});

const DISPLAY_ONLY_PREFIXES = ["rich_note", "copilot_table", "iframe", "youtube"];

type WidgetLocation = "added_to_context" | "on_dashboard" | "connected";

const TIER_TO_LOCATION: Record<WidgetTier, WidgetLocation> = {
  primary: "added_to_context",
  secondary: "on_dashboard",
  extra: "connected",
};

function widgetKind(w: Widget): "data" | "note" | "display" {
  if (w.widget_id.startsWith("rich_note")) return "note";
  if (DISPLAY_ONLY_PREFIXES.some((p) => w.widget_id.startsWith(p))) return "display";
  return "data";
}

export function makeSearchWidgetsTool(
  tiered: TieredWidget[],
  linkedTool: (widget: Widget) => string | undefined = () => undefined,
) {
  return tool({
    description:
      `Find the user's widgets by name, description, category or origin: up to ${SEARCH_RESULT_CAP} matches, best first ` +
      "(added to context, then on the dashboard, then connected), each with `uuid`, `widget_id`, `origin`, `kind`, `location` and params. " +
      "Pass the `uuid` to get_widget_data. If data and note widgets both match, prefer 'data' for numbers. " +
      "`mcp_tool`, when present, names the tool of the widget's own backend that queries it beyond the widget's params (`tool`), " +
      "and how the widget's params fill that tool's arguments (`args`: `$param` or a fixed value).",
    inputSchema: searchWidgetsSchema,
    execute: async ({ query }) => {
      const matches = searchWidgets(tiered, query);
      const results = matches.slice(0, SEARCH_RESULT_CAP).map(({ widget: w, tier }) => {
        const linked = linkedTool(w);
        return {
          uuid: w.uuid,
          widget_id: w.widget_id,
          name: w.name,
          description: w.description,
          category: w.category ?? "",
          origin: w.origin,
          widget_type: w.widget_type,
          kind: widgetKind(w),
          location: TIER_TO_LOCATION[tier],
          params: w.params.length
            ? w.params.map(
                (p) =>
                  `${p.name}:${p.type}=${p.current_value ?? p.default_value ?? "REQUIRED"}`,
              )
            : undefined,
          ...(linked
            ? { mcp_tool: { tool: linked, ...(w.mcp_tool?.args ? { args: w.mcp_tool.args } : {}) } }
            : {}),
        };
      });
      logger.info("Widget search", { query, results: results.length, total: matches.length });
      return { matches: results, total: matches.length };
    },
  });
}
