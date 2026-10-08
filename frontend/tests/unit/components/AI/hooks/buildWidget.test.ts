import { describe, expect, it, vi } from "vitest";

vi.mock("~/lib/utils/sanitize", () => ({
  HTML_SANITIZE_CONFIG: {},
}));

vi.mock("dompurify", () => ({
  default: {
    sanitize: (html: string) => html,
  },
}));

vi.mock("uuid", () => ({
  v4: vi.fn(() => "test-uuid"),
}));

vi.mock("~/lib/utils/format", () => ({
  convertToReadableLabel: (label: string) =>
    label.charAt(0).toUpperCase() + label.slice(1).replace(/_/g, " "),
  isDate: (_value: unknown) => false,
}));

import { buildHtmlWidget, buildNoteWidget } from "~/components/AI/hooks/buildWidget";
import { malformed } from "../../../mocks";

describe("buildHtmlWidget", () => {
  it("sets widgetId prefix to html-", () => {
    const widget = buildHtmlWidget("<h1>Hello</h1>", {
      uuid: "html-uuid",
      name: "HTML Widget",
    });

    expect(widget.widgetId).toBe("html-html-uuid");
    expect(widget.storage?.html).toBe("<h1>Hello</h1>");
  });

  it("sanitizes HTML content", () => {
    const widget = buildHtmlWidget("<div>safe</div>", {
      uuid: "safe-uuid",
      name: "Safe HTML",
      description: "desc",
    });

    expect(widget.storage?.html).toBe("<div>safe</div>");
    expect(widget.name).toBe("Safe HTML");
    expect(widget.description).toBe("desc");
  });
});

describe("buildNoteWidget", () => {
  it("builds a markdown widget that holds the text", () => {
    const widget = buildNoteWidget("# Title\n\nHello World", {
      uuid: "note-uuid",
      name: "Note",
    });

    expect(widget.widgetId).toBe("markdown");
    expect(widget.id).toBe("note-uuid");
    expect(widget.storage?.text).toBe("# Title\n\nHello World");
    expect(widget.storage?.citations).toEqual([]);
    expect(widget.storage?.artifacts).toEqual([]);
  });

  it("strips citation tags when there are no citations to show", () => {
    const content = "Some text. <citation>ref1</citation>";
    const widget = buildNoteWidget(content, {
      uuid: "cite-uuid",
      name: "Citation Note",
    });

    expect(widget.storage?.text).not.toContain("<citation>");
  });

  it("names the widget Note when it has no name", () => {
    const widget = buildNoteWidget("text", { uuid: "n", name: malformed(undefined) });

    expect(widget.name).toBe("Note");
  });

  it("builds a markdown widget when note citations are provided", () => {
    const content = "News summary <|start_citation_id|>cite-1<|end_citation_id|>";
    const citations = [
      {
        id: "cite-1",
        signature: "web|example",
        source_info: { type: "web", name: "https://example.com" },
      },
    ];

    const widget = buildNoteWidget(content, {
      uuid: "citation-note-uuid",
      name: "Citation Note",
      citations,
    });

    expect(widget.widgetId).toBe("markdown");
    expect(widget.storage?.text).toBe(content);
    expect(widget.storage?.citations).toEqual(citations);
    expect(widget.storage?.artifacts).toEqual([]);
  });

  it("builds a markdown widget when note artifacts are provided", () => {
    const content =
      "See report <|start_artifact_id|>html_artifact_6725b<|end_artifact_id|>";
    const artifacts = [
      {
        uuid: "html_artifact_6725b",
        name: "html_artifact_6725b",
        type: "html" as const,
        content: "<p>United States: 67.61</p>",
      },
    ];

    const widget = buildNoteWidget(content, {
      uuid: "artifact-note-uuid",
      name: "Artifact Note",
      artifacts,
    });

    expect(widget.widgetId).toBe("markdown");
    expect(widget.storage?.text).toBe(content);
    expect(widget.storage?.citations).toEqual([]);
    expect(widget.storage?.artifacts).toEqual(artifacts);
  });

  it("defaults the name when none is provided so it never leaks as null", () => {
    const widget = buildNoteWidget("body", {
      uuid: "no-name-uuid",
      name: null as unknown as string,
    });

    expect(widget.name).toBe("Note");
  });
});
