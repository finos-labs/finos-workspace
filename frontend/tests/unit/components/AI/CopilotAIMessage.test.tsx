import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import CopilotAIMessage from "~/components/AI/CopilotAIMessage";
import type { AIMessage, Citation } from "~/lib/state/copilot";
import { useShallowCopilotStore } from "~/lib/state/copilot";
import { makeMessageGroup } from "../../factories";

const markdownMockState = vi.hoisted(() => ({
  RuleType: {
    text: "text",
    codeBlock: "codeBlock",
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("~/lib/state/copilot", () => ({
  useShallowCopilotStore: vi.fn(),
}));

// Text that is still arriving is held by the stream handler (and kept in this store so that stopping
// can keep it). The message never shows it: it shows the message that is in the chat.
const HELD_TEXT = "PARTIAL TEXT THAT HAS NOT BEEN PUT IN THE CHAT";
vi.mock("usehooks-ts", () => ({
  useLocalStorage: vi.fn((key: string, defaultValue: unknown) => [
    key === "streamedData" ? HELD_TEXT : defaultValue,
    vi.fn(),
  ]),
}));

vi.mock("markdown-to-jsx", () => ({
  RuleType: markdownMockState.RuleType,
  default: ({
    children,
    options,
  }: {
    children: string;
    options?: {
      renderRule?: (
        next: () => ReactNode,
        node: { type: unknown; text: string },
        renderChildren: () => ReactNode,
        state: { key: number },
      ) => ReactNode;
    };
  }) => {
    const renderedContent = options?.renderRule
      ? options.renderRule(
          () => children,
          { type: markdownMockState.RuleType.text, text: children },
          () => children,
          { key: 0 },
        )
      : children;

    return <div data-testid="markdown-content">{renderedContent}</div>;
  },
}));

vi.mock("~/components/AI/Citation", () => ({
  default: ({ index, content: _content }: { index: number; content: Citation }) => (
    <span data-testid={`citation-${index}`}>[{index + 1}]</span>
  ),
}));

vi.mock("~/components/AI/CopilotFeedback", () => ({
  CopilotFeedback: ({ message: _message }: { message: AIMessage }) => (
    <div data-testid="feedback-component">Feedback</div>
  ),
}));

vi.mock("~/components/AI/MarkdownOverrides", () => ({
  MarkdownAIMessageOverrides: {},
  renderRule: vi.fn((next) => next()),
}));

vi.mock("~/components/AI/hooks/utils", () => ({
  dispatchCreate: vi.fn(),
}));

vi.mock("~/components/AI/utils/datetimePositioning", () => ({
  getEnhancedDatetimePositionStrategy: vi.fn(() => ({
    shouldShowDatetime: false,
    timestamp: 0,
    targetGroupId: "",
  })),
}));

describe("CopilotAIMessage", () => {
  const mockShowDatetime = vi.fn();
  const mockHideDatetime = vi.fn();
  const mockGetCurrentChatArtifact = vi.fn();

  const baseMessage: AIMessage = {
    role: "ai",
    content: "This is a test AI response.",
    copilotId: "default-copilot",
    timestamp: 1705330200000,
    citations: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();

    (useShallowCopilotStore as Mock).mockImplementation((selector) => {
      return selector({
        showDatetime: mockShowDatetime,
        hideDatetime: mockHideDatetime,
        getCurrentChatArtifact: mockGetCurrentChatArtifact,
      });
    });

    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  describe("message content rendering", () => {
    it("renders AI message content", () => {
      render(<CopilotAIMessage message={baseMessage} />);

      expect(screen.getByTestId("markdown-content")).toBeInTheDocument();
      expect(screen.getByText("This is a test AI response.")).toBeInTheDocument();
    });

    it("renders empty content gracefully", () => {
      const emptyMessage: AIMessage = {
        ...baseMessage,
        content: "",
      };

      const { container } = render(<CopilotAIMessage message={emptyMessage} />);

      expect(container.querySelector(".prose")).not.toBeInTheDocument();
    });

    it("applies correct prose styling", () => {
      const { container } = render(<CopilotAIMessage message={baseMessage} />);

      const proseContainer = container.querySelector(".prose");
      expect(proseContainer).toBeInTheDocument();
      expect(proseContainer).toHaveClass("dark:prose-invert");
    });
  });

  describe("action buttons", () => {
    it("renders copy button", () => {
      const { container } = render(<CopilotAIMessage message={baseMessage} />);

      const buttons = container.querySelectorAll("button");
      expect(buttons.length).toBeGreaterThanOrEqual(2);
    });

    it("copies message text to clipboard when copy button is clicked", async () => {
      const { container } = render(<CopilotAIMessage message={baseMessage} />);

      const buttons = container.querySelectorAll("button");
      const copyButton = buttons[0];

      fireEvent.click(copyButton);

      await waitFor(() => {
        expect(navigator.clipboard.writeText).toHaveBeenCalled();
        expect(toast.success).toHaveBeenCalledWith("Text copied to clipboard");
      });
    });

    it("renders create widget button", () => {
      const { container } = render(<CopilotAIMessage message={baseMessage} />);

      const buttons = container.querySelectorAll("button");
      expect(buttons.length).toBeGreaterThanOrEqual(2);
    });

    it("renders feedback component", () => {
      render(<CopilotAIMessage message={baseMessage} />);

      expect(screen.getByTestId("feedback-component")).toBeInTheDocument();
    });
  });

  describe("cancelled message handling", () => {
    it("displays cancellation notice when message is cancelled", () => {
      const cancelledMessage: AIMessage = {
        ...baseMessage,
        isCancelled: true,
      };

      render(<CopilotAIMessage message={cancelledMessage} />);

      expect(
        screen.getByText("Request cancelled before completion"),
      ).toBeInTheDocument();
    });

    it("applies warning styling to cancellation notice", () => {
      const cancelledMessage: AIMessage = {
        ...baseMessage,
        isCancelled: true,
      };

      const { container } = render(<CopilotAIMessage message={cancelledMessage} />);

      const warningContainer = container.querySelector(".bg-orange-50");
      expect(warningContainer).toBeInTheDocument();
    });

    it("shows action buttons when cancelled but has content", () => {
      const cancelledWithContent: AIMessage = {
        ...baseMessage,
        content: "Partial response before cancellation",
        isCancelled: true,
      };

      const { container } = render(<CopilotAIMessage message={cancelledWithContent} />);

      expect(screen.getByTestId("feedback-component")).toBeInTheDocument();
    });

    it("hides action buttons when cancelled with no content", () => {
      const cancelledNoContent: AIMessage = {
        ...baseMessage,
        content: "",
        isCancelled: true,
      };

      render(<CopilotAIMessage message={cancelledNoContent} />);

      expect(screen.queryByTestId("feedback-component")).not.toBeInTheDocument();
    });
  });

  describe("text that is still arriving", () => {
    it("shows the message in the chat, never the text held for it", () => {
      render(<CopilotAIMessage message={baseMessage} />);

      expect(screen.getByText("This is a test AI response.")).toBeInTheDocument();
      expect(screen.queryByText(HELD_TEXT)).not.toBeInTheDocument();
    });
  });

  describe("hover interactions", () => {
    it("triggers datetime display on mouse enter when groups available", () => {
      const allGroups = [makeMessageGroup(), makeMessageGroup()];

      const { container } = render(
        <CopilotAIMessage message={baseMessage} allGroups={allGroups} groupIndex={0} />,
      );

      const messageContainer = container.querySelector(".relative.group");
      if (messageContainer) {
        fireEvent.mouseEnter(messageContainer);
      }
    });

    it("hides datetime on mouse leave", () => {
      const { container } = render(<CopilotAIMessage message={baseMessage} />);

      const messageContainer = container.querySelector(".relative.group");
      if (messageContainer) {
        fireEvent.mouseLeave(messageContainer);
      }
    });
  });

  describe("styling", () => {
    it("applies relative positioning to container", () => {
      const { container } = render(<CopilotAIMessage message={baseMessage} />);

      const relativeContainer = container.querySelector(".relative.group");
      expect(relativeContainer).toBeInTheDocument();
    });

    it("applies full width styling", () => {
      const { container } = render(<CopilotAIMessage message={baseMessage} />);

      const widthContainer = container.querySelector(".w-full");
      expect(widthContainer).toBeInTheDocument();
    });

    it("applies general primary background styling", () => {
      const { container } = render(<CopilotAIMessage message={baseMessage} />);

      const bgContainer = container.querySelector(".bg-general-bg-primary");
      expect(bgContainer).toBeInTheDocument();
    });
  });

  describe("message with citations", () => {
    it("renders message with citation markers", () => {
      const messageWithCitations: AIMessage = {
        ...baseMessage,
        content: 'Here is some information <citation className="cite-1"/>',
        citations: [
          {
            id: "cite-1",
            source_info: {
              type: "widget",
              name: "Test Widget",
            },
            signature: "widget-signature",
          },
        ],
      };

      render(<CopilotAIMessage message={messageWithCitations} />);

      expect(screen.getByTestId("markdown-content")).toBeInTheDocument();
    });
  });

  describe("message with complex content", () => {
    it("renders message with code blocks", () => {
      const messageWithCode: AIMessage = {
        ...baseMessage,
        content: "```python\nprint('hello')\n```",
      };

      render(<CopilotAIMessage message={messageWithCode} />);

      expect(screen.getByTestId("markdown-content")).toBeInTheDocument();
    });

    it("renders message with markdown formatting", () => {
      const markdownMessage: AIMessage = {
        ...baseMessage,
        content: "**Bold** and *italic* text with [links](https://example.com)",
      };

      render(<CopilotAIMessage message={markdownMessage} />);

      expect(screen.getByTestId("markdown-content")).toBeInTheDocument();
    });

    it("does not escape underscores inside URLs", () => {
      const messageWithUrl: AIMessage = {
        ...baseMessage,
        content:
          "More info: https://example.com/path_with_underscore?query=foo_bar and text_with_underscores",
      };

      render(<CopilotAIMessage message={messageWithUrl} />);

      const markdown = screen.getByTestId("markdown-content");
      expect(markdown.textContent).toContain(
        "https://example.com/path_with_underscore?query=foo_bar",
      );
      expect(markdown.textContent).toContain("text\\_with\\_underscores");
    });

    it("renders message with tables", () => {
      const tableMessage: AIMessage = {
        ...baseMessage,
        content: "| Header 1 | Header 2 |\n|---|---|\n| Cell 1 | Cell 2 |",
      };

      render(<CopilotAIMessage message={tableMessage} />);

      expect(screen.getByTestId("markdown-content")).toBeInTheDocument();
    });
  });

  describe("divider and actions layout", () => {
    it("renders divider between content and actions", () => {
      const { container } = render(<CopilotAIMessage message={baseMessage} />);

      const divider = container.querySelector(".ws-divider");
      expect(divider).toBeInTheDocument();
    });

    it("renders actions in inline-block container", () => {
      const { container } = render(<CopilotAIMessage message={baseMessage} />);

      const inlineBlock = container.querySelector(".inline-block");
      expect(inlineBlock).toBeInTheDocument();
    });
  });
});
