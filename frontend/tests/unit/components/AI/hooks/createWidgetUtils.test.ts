import { describe, expect, it } from "vitest";
import {
  createConversationContextPayload,
  getFallbackName,
  removeCitationsFromText,
} from "~/components/AI/hooks/createWidgetUtils";
import type { ArtifactT, CopilotWidget, Message } from "~/lib/state/copilot";
import { partial } from "../../../mocks";

describe("createWidgetUtils", () => {
  describe("getFallbackName", () => {
    it("returns correct name for text type", () => {
      expect(getFallbackName("text")).toBe("Text Artifact");
    });

    it("returns correct name for html type", () => {
      expect(getFallbackName("html")).toBe("HTML Artifact");
    });

    it("returns generic Artifact for unknown type", () => {
      expect(getFallbackName("unknown")).toBe("Artifact");
      expect(getFallbackName("")).toBe("Artifact");
    });
  });

  describe("createConversationContextPayload", () => {
    const baseMessage: Message = {
      role: "human",
      content: "test message",
      copilotId: "default-copilot",
      timestamp: Date.now(),
    } as Message;

    const baseWidget: CopilotWidget = {
      origin: "copilot",
      widget_id: "widget-1",
      name: "Test Widget",
      description: "A test widget",
      params: [],
      metadata: {},
    };

    const baseArtifact: ArtifactT = {
      uuid: "artifact-1",
      type: "text",
      content: "Test artifact content",
      name: "Test Artifact",
      description: "A test artifact",
    };

    it("creates payload with correct user_prompt", () => {
      const payload = createConversationContextPayload("my prompt", [], [], []);
      expect(payload.user_prompt).toBe("my prompt");
    });

    it("limits recent_messages to last 5", () => {
      const messages = Array.from({ length: 10 }, (_, i) => ({
        ...baseMessage,
        content: `message ${i}`,
      })) as Message[];

      const payload = createConversationContextPayload("prompt", messages, [], []);

      expect(payload.recent_messages).toHaveLength(5);
      expect((payload.recent_messages[0] as { content: string }).content).toBe(
        "message 5",
      );
      expect((payload.recent_messages[4] as { content: string }).content).toBe(
        "message 9",
      );
    });

    it("handles fewer than 5 messages", () => {
      const messages = [
        baseMessage,
        { ...baseMessage, content: "second" },
      ] as Message[];

      const payload = createConversationContextPayload("prompt", messages, [], []);

      expect(payload.recent_messages).toHaveLength(2);
    });

    it("limits related_artifacts to last 3", () => {
      const artifacts: ArtifactT[] = Array.from({ length: 6 }, (_, i) => ({
        ...baseArtifact,
        uuid: `artifact-${i}`,
        name: `Artifact ${i}`,
      }));

      const payload = createConversationContextPayload("prompt", [], [], artifacts);

      expect(payload.related_artifacts).toHaveLength(3);
      expect(payload.related_artifacts[0].name).toBe("Artifact 3");
      expect(payload.related_artifacts[2].name).toBe("Artifact 5");
    });

    it("strips widget metadata to only innerTabId and widgetCount", () => {
      const widgetWithFullMetadata: CopilotWidget = {
        ...baseWidget,
        metadata: partial({
          innerTabId: "tab-123",
          widgetCount: 5,
          someOtherField: "should be removed",
        }),
      };

      const payload = createConversationContextPayload(
        "prompt",
        [],
        [widgetWithFullMetadata],
        [],
      );

      expect(payload.selected_widgets[0].metadata).toEqual({
        innerTabId: "tab-123",
        widgetCount: 5,
      });
    });

    it("handles widgets without metadata", () => {
      const widgetWithoutMetadata: CopilotWidget = {
        ...baseWidget,
        metadata: undefined,
      };

      const payload = createConversationContextPayload(
        "prompt",
        [],
        [widgetWithoutMetadata],
        [],
      );

      expect(payload.selected_widgets[0].metadata).toBeUndefined();
    });
  });

  describe("removeCitationsFromText", () => {
    it("removes citation tags with preceding period and space", () => {
      const text = "Some text. <citation>ref1</citation>";
      expect(removeCitationsFromText(text)).toBe("Some text");
    });

    it("removes citation tags with trailing period", () => {
      const text = "Some text<citation>ref1</citation>.";
      expect(removeCitationsFromText(text)).toBe("Some text.");
    });

    it("removes multiple citations", () => {
      const text =
        "First point. <citation>ref1</citation> Second point. <citation>ref2</citation>";
      expect(removeCitationsFromText(text)).toBe("First point Second point");
    });

    it("preserves text without citations", () => {
      const text = "No citations here.";
      expect(removeCitationsFromText(text)).toBe("No citations here.");
    });

    it("handles empty string", () => {
      expect(removeCitationsFromText("")).toBe("");
    });

    it("handles citation at the start of text", () => {
      const text = "<citation>ref1</citation> Some text";
      expect(removeCitationsFromText(text)).toBe(" Some text");
    });
  });
});
