import { useEffect, useMemo } from "react";
import { AI_PROMPTS } from "~/lib/constants";
import { type CopilotWidget, useShallowCopilotStore } from "~/lib/state/copilot";

export function useTextSuggestions(
  selectedWidgets: CopilotWidget[] | null,
  dashboardWidgets: CopilotWidget[],
) {
  const { messages, setCopilotTextSuggestions } = useShallowCopilotStore((state) => ({
    messages: state.getCurrentChat()?.messages ?? [],
    setCopilotTextSuggestions: state.setCopilotTextSuggestions,
  }));

  const widgetTitles = useMemo(() => {
    if (selectedWidgets?.length) {
      return selectedWidgets.map((widget) => widget.name);
    }
    return dashboardWidgets.map((widget) => widget.name);
  }, [dashboardWidgets, selectedWidgets]);

  const copilotTextSuggestions = useMemo(() => {
    const hasMessages = messages.length > 0;

    if (widgetTitles.length > 0) {
      const matchedPrompts = Object.entries(AI_PROMPTS).map(([question, ids]) => {
        const matchCount = ids.reduce(
          (count, id) => count + (widgetTitles.includes(id) ? 1 : 0),
          0,
        );
        return { question, matchCount, idsLength: ids.length };
      });

      const exactMatchedPrompts = matchedPrompts
        .filter(({ matchCount, idsLength }) => matchCount === idsLength)
        .sort(() => (hasMessages ? Math.random() - 0.5 : 0));

      const exactMatchedPromptsUnused = exactMatchedPrompts.filter(
        (item) =>
          !messages.some(
            (message) => message.role === "human" && message.content === item.question,
          ),
      );

      return exactMatchedPromptsUnused.sort((a, b) => b.matchCount - a.matchCount);
    }
    return [];
  }, [widgetTitles, messages]);

  useEffect(() => {
    setCopilotTextSuggestions(copilotTextSuggestions);
  }, [copilotTextSuggestions]);
}
