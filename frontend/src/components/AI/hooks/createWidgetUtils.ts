import type { ArtifactT, CopilotWidget, Message } from "~/lib/state/copilot";

interface ConversationContext {
  user_prompt: string;
  recent_messages: Message[];
  selected_widgets: (Omit<CopilotWidget, "metadata"> & {
    metadata?: Pick<
      NonNullable<CopilotWidget["metadata"]>,
      "innerTabId" | "widgetCount"
    >;
  })[];
  related_artifacts: ArtifactT[];
}

export function getFallbackName(widgetType: string): string {
  const typeNames: Record<string, string> = {
    text: "Text Artifact",
    html: "HTML Artifact",
    plugin: "Plugin Artifact",
  };
  return typeNames[widgetType] || "Artifact";
}

export function createConversationContextPayload(
  user_prompt: string,
  recent_messages: Message[],
  selected_widgets: CopilotWidget[],
  related_artifacts: ArtifactT[],
): ConversationContext {
  return {
    user_prompt,
    recent_messages: recent_messages.slice(-5),
    selected_widgets: selected_widgets.map((widget) => ({
      ...widget,
      metadata: widget.metadata
        ? {
            innerTabId: widget.metadata.innerTabId,
            widgetCount: widget.metadata.widgetCount,
          }
        : undefined,
    })),
    related_artifacts: related_artifacts.slice(-3),
  };
}

export function removeCitationsFromText(text: string): string {
  return text.replace(/(?:\.\s*)?<citation>.*?<\/citation>(\s*\.)?/g, "$1");
}
