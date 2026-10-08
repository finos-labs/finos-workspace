import type { ArtifactT, CopilotWidget, Message } from "~/lib/state/copilot";

export interface ConversationContext {
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

/**
 * Returns a human-readable fallback name for a widget based on its type.
 */
export function getFallbackName(widgetType: string): string {
  const typeNames: Record<string, string> = {
    text: "Text Artifact",
    html: "HTML Artifact",
  };
  return typeNames[widgetType] || "Artifact";
}

/**
 * Creates a conversation context payload for the AI widget info API.
 * Limits recent messages to last 5 and artifacts to last 3.
 */
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

/**
 * Removes citation tags from text content.
 * Handles patterns like: ". <citation>...</citation>" or "<citation>...</citation>."
 */
export function removeCitationsFromText(text: string): string {
  return text.replace(/(?:\.\s*)?<citation>.*?<\/citation>(\s*\.)?/g, "$1");
}
