import { tool } from "ai";
import { z } from "zod";
import { getLogger } from "../../lib/logger.ts";

const logger = getLogger(["app", "tools", "suggest_followups"]);

const suggestFollowupsSchema = z.object({
  suggestions: z
    .array(z.string().min(1).max(80))
    .min(1)
    .max(3)
    .describe(
      "2-3 short follow-up questions the user might ask next, written in the USER's voice as their " +
        "next message. If your final answer ended by asking the user something or offering options, " +
        "these ARE the answers to that question, one per option. Each under 80 characters and " +
        "answerable using the widgets and data sources listed in context — never suggest " +
        "questions that need data you don't have.",
    ),
});

const suggestFollowupsDescription =
  "Provide 2-3 short follow-up questions the user might want to ask next, phrased as the user would " +
  "type them. Call once, at the END of your response, after the final answer. If that answer ended " +
  "with a question or a choice for the user, the suggestions must answer it. " +
  "Each suggestion must be answerable with the available widgets/data sources.";

type SuggestFollowupsArgs = z.infer<typeof suggestFollowupsSchema>;

interface SuggestFollowupsContext {
  setSuggestions: (suggestions: string[]) => void;
}

export function makeSuggestionsTool(ctx: SuggestFollowupsContext) {
  return tool({
    description: suggestFollowupsDescription,
    inputSchema: suggestFollowupsSchema,
    execute: async (args) => {
      const { suggestions } = args as SuggestFollowupsArgs;
      ctx.setSuggestions(suggestions);
      logger.info("suggest_followups captured", { count: suggestions.length });
      return `Recorded ${suggestions.length} follow-up suggestion(s).`;
    },
  });
}
