import { describe, it, expect, mock, beforeEach } from "bun:test";

// Must be set before the handler module is imported — RENDER_TIMEOUT_MS is
// read at module scope.
process.env.MERMAID_RENDER_TIMEOUT_MS = "200";

// The renderer module runs Mermaid in headless Chromium; the handler only needs its result shape:
// { ok: true, svg } or { ok: false, syntaxError }. A launch failure or timeout throws.
type Rendered = { ok: true; svg: string } | { ok: false; syntaxError: string };
const renderMock = mock(
  async (_source: string, _timeoutMs: number): Promise<Rendered> => ({
    ok: true,
    svg: '<svg id="m-0"><text>Login</text></svg>',
  }),
);

mock.module("../../../../../mcp-server/src/tools/backend/mermaid-render", () => ({
  renderMermaidSvg: renderMock,
}));

const { mermaidDescription, mermaidHandler } = await import(
  "../../../../../mcp-server/src/tools/backend/mermaid"
);

beforeEach(() => {
  renderMock.mockClear();
  renderMock.mockImplementation(async () => ({
    ok: true,
    svg: '<svg id="m-0"><text>Login</text></svg>',
  }));
});

describe("mermaidHandler", () => {
  it("guides flowchart-like render requests to a flowchart TD Mermaid pattern", () => {
    expect(mermaidDescription).toContain("flowchart TD");
    expect(mermaidDescription).toContain('node_id["Display Label"]');
    expect(mermaidDescription).toContain("parentheses");
    expect(mermaidDescription).toContain("Do NOT wrap Mermaid in HTML");
    expect(mermaidDescription).toContain("create_html_artifact");
  });

  it("emits an html artifact wrapping the rendered svg, then an instructional text item", async () => {
    const res = await mermaidHandler({
      name: "Flow",
      description: "Auth flow",
      code: "graph TD\nA-->B",
    });
    expect(res.content).toHaveLength(2);
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.$ines_kind).toBe("artifact");
    expect(parsed.artifact.type).toBe("html");
    expect(parsed.artifact.name).toBe("Flow");
    expect(parsed.artifact.description).toBe("Auth flow");
    expect(parsed.artifact.uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(parsed.artifact.content).toContain("<svg");
    expect(parsed.artifact.content).toContain("<!DOCTYPE html>");
    expect(parsed.artifact.content).toContain("background:#fff");
    expect(res.content[1].text).toContain('Rendered diagram "Flow"');
    expect(res.content[1].text).toContain("Do NOT repeat the Mermaid code");
  });

  it("prepends the htmlLabels-disabling init directive to the diagram source", async () => {
    await mermaidHandler({ name: "F", description: "d", code: "graph TD\nA-->B" });
    const source = renderMock.mock.calls[0]?.[0];
    expect(source).toMatch(/^%%\{init: .*"htmlLabels":false.*\}%%\n/);
    expect(source).toContain("graph TD\nA-->B");
  });

  it("recovers flowchart labels with parentheses by quoting simple node labels", async () => {
    renderMock
      .mockImplementationOnce(async () => ({ ok: false, syntaxError: "Parse error on line 2" }))
      .mockImplementationOnce(async () => ({
        ok: true,
        svg: "<svg><text>Open Data Platform</text></svg>",
      }));

    const res = await mermaidHandler({
      name: "Products",
      description: "Product map",
      code: "flowchart TD\n  A[Products] --> E[Open Data Platform (ODP)]",
    });

    expect(renderMock).toHaveBeenCalledTimes(2);
    expect(renderMock.mock.calls[1]?.[0]).toContain('A["Products"]');
    expect(renderMock.mock.calls[1]?.[0]).toContain('E["Open Data Platform (ODP)"]');
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.$ines_kind).toBe("artifact");
    expect(parsed.artifact.content).toContain("<svg");
  });

  it("each call produces a distinct artifact uuid and its own render", async () => {
    const a = await mermaidHandler({ name: "A", description: "", code: "graph TD" });
    const b = await mermaidHandler({ name: "A", description: "", code: "graph TD" });
    const aId = JSON.parse(a.content[0].text).artifact.uuid;
    const bId = JSON.parse(b.content[0].text).artifact.uuid;
    expect(aId).not.toBe(bId);
    expect(renderMock).toHaveBeenCalledTimes(2);
  });

  it("rejected render returns a typed syntax error with retry instruction, no artifact", async () => {
    renderMock.mockImplementationOnce(async () => ({ ok: false, syntaxError: "Parse error on line 2" }));
    const res = await mermaidHandler({ name: "F", description: "d", code: "broken %%%" });
    expect(res.content).toHaveLength(1);
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.$ines_kind).toBe("error");
    expect(parsed.error.code).toBe("MERMAID_SYNTAX");
    expect(parsed.error.message).toContain("Mermaid syntax error: Parse error on line 2");
    expect(parsed.error.message).toContain("call mermaid_diagram again");
  });

  it("svg containing foreignObject is rejected with a diagram-type guidance message", async () => {
    renderMock.mockImplementationOnce(async () => ({
      ok: true,
      svg: "<svg><foreignObject><div>X</div></foreignObject></svg>",
    }));
    const res = await mermaidHandler({ name: "F", description: "d", code: "exotic" });
    expect(res.content).toHaveLength(1);
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.$ines_kind).toBe("error");
    expect(parsed.error.code).toBe("MERMAID_UNSUPPORTED_DIAGRAM");
    expect(parsed.error.message).toContain("cannot display");
    expect(parsed.error.message).toContain("call mermaid_diagram again");
  });

  it("a render that throws (timeout) returns a failure text item", async () => {
    renderMock.mockImplementationOnce(async () => {
      throw new Error("render timed out after 200ms");
    });
    const res = await mermaidHandler({ name: "F", description: "d", code: "graph TD" });
    expect(res.content).toHaveLength(1);
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.$ines_kind).toBe("error");
    expect(parsed.error.code).toBe("MERMAID_RENDER_FAILED");
    expect(parsed.error.message).toContain("Diagram rendering failed");
    expect(parsed.error.message).toContain("timed out");
  });

  it("passes the configured timeout to the renderer", async () => {
    await mermaidHandler({ name: "F", description: "d", code: "graph TD" });
    expect(renderMock.mock.calls[0]?.[1]).toBe(200);
  });

  it("a browser launch failure returns a failure text item", async () => {
    renderMock.mockImplementationOnce(async () => {
      throw new Error("browser not found");
    });
    const res = await mermaidHandler({ name: "F", description: "d", code: "graph TD" });
    expect(res.content).toHaveLength(1);
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.$ines_kind).toBe("error");
    expect(parsed.error.code).toBe("MERMAID_RENDER_FAILED");
    expect(parsed.error.message).toContain("Diagram rendering failed: browser not found");
  });
});
