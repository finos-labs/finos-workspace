import { describe, it, expect } from "bun:test";
import { observed } from "../../../../mcp-server/src/lib/observe";
import { renderMetrics } from "../../../../src/lib/metrics";

const line = (text: string, prefix: string) => text.split("\n").find((l) => l.startsWith(prefix));

describe("observed", () => {
  it("returns what the tool returns and counts and times the call", async () => {
    const tool = observed("observe_test_ok", async (args: { n: number }) => ({ content: [{ type: "text", text: `n=${args.n}` }] }));
    const result = await tool({ n: 3 });
    expect(result.content[0].text).toBe("n=3");
    const text = renderMetrics();
    expect(line(text, 'ines_mcp_tool_calls_total{tool="observe_test_ok",outcome="ok"}')).toBe(
      'ines_mcp_tool_calls_total{tool="observe_test_ok",outcome="ok"} 1',
    );
    expect(text).toContain('ines_mcp_tool_duration_seconds_count{tool="observe_test_ok"} 1');
  });

  it("counts a tool that answers with an error item as an error, and still returns it", async () => {
    const tool = observed("observe_test_item", async () => ({
      content: [{ type: "text", text: JSON.stringify({ $ines_kind: "error", error: { code: "X", message: "no" } }) }],
    }));
    const result = await tool({});
    expect(JSON.parse(result.content[0].text).error.code).toBe("X");
    expect(renderMetrics()).toContain('ines_mcp_tool_calls_total{tool="observe_test_item",outcome="error"} 1');
  });

  it("counts a tool that throws as an error, and lets the error through", async () => {
    const tool = observed("observe_test_throw", async () => {
      throw new Error("boom");
    });
    await expect(tool({})).rejects.toThrow("boom");
    expect(renderMetrics()).toContain('ines_mcp_tool_calls_total{tool="observe_test_throw",outcome="error"} 1');
  });
});
