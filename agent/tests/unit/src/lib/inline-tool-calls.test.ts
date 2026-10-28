import { describe, it } from "node:test";
import { expect } from "expect";
import { simulateReadableStream, streamText, tool, generateText } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";
import { extractInlineToolCalls, withInlineToolCalls } from "../../../../src/lib/inline-tool-calls.ts";

const TOOLS = new Set(["execute_sql", "Ines_Tools_web_search", "get_widget_data"]);
const calls = (text: string) => extractInlineToolCalls(text, TOOLS);
const only = (text: string) => {
  const { segments } = calls(text);
  return segments.filter((s) => s.type === "call").map((s) => ({ name: (s as { name: string }).name, input: JSON.parse((s as { input: string }).input) }));
};

describe("extractInlineToolCalls", () => {
  it("reads <tool_call> with a name and arguments, and leaves the text around it", () => {
    const { segments, dropped } = calls('I will look. <tool_call>{"name": "execute_sql", "arguments": {"sql": "SELECT 1"}}</tool_call> Done.');
    expect(dropped).toBe(0);
    expect(segments).toEqual([
      { type: "text", text: "I will look. " },
      { type: "call", name: "execute_sql", input: '{"sql":"SELECT 1"}' },
      { type: "text", text: " Done." },
    ]);
  });

  it("reads the other formats models write", () => {
    expect(only('<TOOLCALL>[{"name": "execute_sql", "arguments": {"sql": "SELECT 1"}}, {"name": "Ines_Tools_web_search", "arguments": {"query": "nvidia"}}]</TOOLCALL>')).toEqual([
      { name: "execute_sql", input: { sql: "SELECT 1" } },
      { name: "Ines_Tools_web_search", input: { query: "nvidia" } },
    ]);
    expect(only('<function=execute_sql>{"sql": "SELECT 2"}</function>')).toEqual([{ name: "execute_sql", input: { sql: "SELECT 2" } }]);
    expect(only('[TOOL_CALLS][{"name": "get_widget_data", "arguments": {"widgets": []}}]')).toEqual([{ name: "get_widget_data", input: { widgets: [] } }]);
    expect(only('<function_call>{"name": "execute_sql", "parameters": {"sql": "SELECT 3"}}</function_call>')).toEqual([{ name: "execute_sql", input: { sql: "SELECT 3" } }]);
    expect(only('<tool_call>{"function": {"name": "execute_sql", "arguments": "{\\"sql\\": \\"SELECT 4\\"}"}}</tool_call>')).toEqual([{ name: "execute_sql", input: { sql: "SELECT 4" } }]);
  });

  it("reads several markers in one text, in order, of different formats", () => {
    const { segments } = calls('a <tool_call>{"name":"execute_sql","arguments":{}}</tool_call> b <function=get_widget_data>{"widgets": []}</function> c');
    expect(segments.map((s) => (s.type === "text" ? s.text.trim() : s.name))).toEqual(["a", "execute_sql", "b", "get_widget_data", "c"]);
  });

  it("reads JSON that is in a code fence, and a marker in any case", () => {
    expect(only('<TOOL_CALL>\n```json\n{"name": "execute_sql", "arguments": {"sql": "SELECT 5"}}\n```\n</TOOL_CALL>')).toEqual([{ name: "execute_sql", input: { sql: "SELECT 5" } }]);
  });

  it("drops a marker that cannot be read, or names a tool that is not offered, and shows neither", () => {
    for (const text of [
      "x <tool_call>{not json}</tool_call> y",
      'x <tool_call>{"name": "rm_rf", "arguments": {}}</tool_call> y',
      'x <tool_call>{"name": "execute_sql", "arguments": "not json"}</tool_call> y',
      'x <tool_call>{"name": "execute_sql", "arguments": [1]}</tool_call> y',
      'x <tool_call>[{"name": "execute_sql", "arguments": {}}, {"name": "rm_rf", "arguments": {}}]</tool_call> y',
    ]) {
      const { segments, dropped } = calls(text);
      expect(dropped).toBe(1);
      expect(segments.every((s) => s.type === "text")).toBe(true);
      expect(segments.map((s) => (s as { text: string }).text).join("")).not.toContain("tool_call");
    }
  });

  it("drops a marker that never ends, from its start to the end of the text", () => {
    const { segments, dropped } = calls('The answer is <tool_call>{"name": "execute_sql", "argu');
    expect(dropped).toBe(1);
    expect(segments).toEqual([{ type: "text", text: "The answer is " }]);
  });

  it("leaves text that has no marker as it is, including angle brackets that are not one", () => {
    const { segments, dropped } = calls("P/E < 15 and <b>bold</b> and [tool calls] and <function> are words.");
    expect(dropped).toBe(0);
    expect(segments).toEqual([{ type: "text", text: "P/E < 15 and <b>bold</b> and [tool calls] and <function> are words." }]);
  });

  it("reads a text made of a great many markers in one pass", () => {
    const marker = '<tool_call>{"name": "execute_sql", "arguments": {}}</tool_call>';
    const start = performance.now();
    const { segments } = calls(marker.repeat(20_000));
    expect(performance.now() - start).toBeLessThan(2000);
    expect(segments).toHaveLength(20_000);
    for (const hostile of ["<tool_call>".repeat(100_000), "<function=a>".repeat(50_000), "[TOOL_CALLS]".repeat(50_000), `<tool_call>${" ".repeat(1_000_000)}`]) {
      const t = performance.now();
      calls(hostile);
      expect(performance.now() - t).toBeLessThan(2000);
    }
  });
});

function markerModel(steps: string[][], finish: "stop" | "tool-calls" = "stop") {
  let call = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text", text: (steps[Math.min(call++, steps.length - 1)] ?? []).join("") }],
      finishReason: { unified: finish, raw: finish },
      usage: { inputTokens: { total: 1, noCache: 1 }, outputTokens: { total: 1, text: 1 }, totalTokens: 2 },
      warnings: [],
    }),
    doStream: async () => {
      const deltas = steps[Math.min(call++, steps.length - 1)] ?? [];
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t0" },
            ...deltas.map((delta) => ({ type: "text-delta" as const, id: "t0", delta })),
            { type: "text-end", id: "t0" },
            { type: "finish", finishReason: { unified: finish, raw: finish }, usage: { inputTokens: { total: 1, noCache: 1 }, outputTokens: { total: 1, text: 1 }, totalTokens: 2 } },
          ],
        }),
      };
    },
  } as never);
}

const TOOLSET = {
  execute_sql: tool({
    description: "Run SQL",
    inputSchema: z.object({ sql: z.string() }),
    execute: async ({ sql }) => `ran ${sql}`,
  }),
};

describe("withInlineToolCalls", () => {
  it("turns a marker in a streamed text into a tool call that the SDK runs, and the text that is left is the text", async () => {
    const model = withInlineToolCalls(
      markerModel([
        ["I'll check the prices. <tool_", 'call>{"name": "execute_sql", "argu', 'ments": {"sql": "SELECT 1"}}</tool', "_call>"],
        ["The close is 200."],
      ]) as never,
    );
    const result = streamText({ model, tools: TOOLSET, prompt: "go", stopWhen: ({ steps }) => steps.length >= 3 });
    const parts: { type: string; text?: string; toolName?: string }[] = [];
    for await (const part of result.fullStream) {
      if (["text-delta", "tool-call", "tool-result", "finish-step"].includes(part.type)) parts.push(part as never);
    }
    const steps = await result.steps;
    expect(steps).toHaveLength(2);
    expect(steps[0].toolCalls.map((c) => c.toolName)).toEqual(["execute_sql"]);
    expect(steps[0].toolCalls[0].input).toEqual({ sql: "SELECT 1" });
    expect(steps[0].text).toBe("I'll check the prices. ");
    expect(steps[0].toolResults[0].output).toBe("ran SELECT 1");
    expect(steps[0].finishReason).toBe("tool-calls");
    expect(steps[1].finishReason).toBe("stop");
    expect(steps[1].toolCalls).toHaveLength(0);
    expect(steps[1].text).toBe("The close is 200.");
    expect(parts.map((p) => p.text ?? "").join("")).not.toContain("tool_call");
  });

  it("does not touch a model that makes native tool calls, or a text without markers", async () => {
    const plain = markerModel([["Just an answer."]]);
    const model = withInlineToolCalls(plain as never);
    const result = streamText({ model, tools: TOOLSET, prompt: "go" });
    expect(await result.text).toBe("Just an answer.");
    expect((await result.steps)[0].toolCalls).toHaveLength(0);
  });

  it("leaves the text alone when the request offers no tools, so that a marker is only read where it can be run", async () => {
    const text = '<tool_call>{"name": "execute_sql", "arguments": {}}</tool_call>';
    const model = withInlineToolCalls(markerModel([[text]]) as never);
    const result = streamText({ model, prompt: "go" });
    expect(await result.text).toBe(text);
  });

  it("drops a marker for a tool that is not offered instead of showing it", async () => {
    const model = withInlineToolCalls(
      markerModel([['Done. <tool_call>{"name": "rm_rf", "arguments": {}}</tool_call>']]) as never,
    );
    const result = streamText({ model, tools: TOOLSET, prompt: "go" });
    expect(await result.text).toBe("Done. ");
    expect((await result.steps)[0].toolCalls).toHaveLength(0);
  });

  it("reads a text that was not streamed the same way", async () => {
    const model = withInlineToolCalls(
      markerModel([['Let me check. <tool_call>{"name": "execute_sql", "arguments": {"sql": "SELECT 9"}}</tool_call>'], ["Nine."]]) as never,
    );
    const result = await generateText({ model, tools: TOOLSET, prompt: "go", stopWhen: ({ steps }) => steps.length >= 3 });
    expect(result.steps[0].toolCalls[0].toolName).toBe("execute_sql");
    expect(result.steps[0].finishReason).toBe("tool-calls");
    expect(result.text).toBe("Nine.");
  });
});
