import { z } from "zod";
import type { ContentItem } from "../../lib/typed.ts";
import { bridgeManager } from "../../bridge/singleton.ts";
import { executeBridgeCommand } from "../../bridge/execute.ts";

export const listAvailableWidgetsSchema = {
  origin: z
    .string()
    .optional()
    .describe(
      "Friendly catalog label (e.g. 'Options Activity Monitor'). Matches exactly.",
    ),
  backend_id: z
    .string()
    .optional()
    .describe("Optional backend UUID returned by manage_backends."),
} as const;

export const listAvailableWidgetsDescription =
  "List widgets available to the current FINOS Workspace session. " +
  "Returns deterministic widget identities for later get_widget_schema and create_widget calls. " +
  "Optional filters: origin matches the friendly catalog label exactly; backend_id matches the backend UUID. " +
  "Use backend_id only when you have a UUID from manage_backends; use origin when working from a snapshot. " +
  "Both can be passed together for a stricter match. Without filters the entire catalog is returned, " +
  "which can be hundreds of widgets — prefer a filter when you know the source. " +
  "Generative-only note widgets such as rich_note are intentionally excluded; use add_generative_widget for those.";

export async function listAvailableWidgetsHandler(args: {
  origin?: string;
  backend_id?: string;
}): Promise<{ content: ContentItem[] }> {
  const { content } = await executeBridgeCommand(bridgeManager, {
    command: "list_available_widgets",
    origin: args.origin ?? null,
    backend_id: args.backend_id ?? null,
  });
  return { content };
}
