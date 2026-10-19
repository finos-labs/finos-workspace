import { tool } from "ai";
import { z } from "zod";
import { displaySummarySchema } from "./progress";

const widgetRequestSchema = z.object({
  widget_uuid: z.string().describe(
    "The widget's `uuid`, as search_widgets returns it or the widget list shows it.",
  ),
  input_args: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Parameter overrides for this widget."),
});

export const widgetDataSchema = z.object({
  display_summary: displaySummarySchema,
  widgets: z
    .array(widgetRequestSchema)
    .describe("Widgets to load."),
});

export type WidgetRequest = z.infer<typeof widgetRequestSchema>;

export function makeWidgetDataTool() {
  return tool({
    description:
      "Load the data of one or more widgets (rows, text, an image, or a file to search). " +
      "Pass each widget's exact `uuid` as `widget_uuid` and any parameter overrides as `input_args`.",
    inputSchema: widgetDataSchema,
  });
}
