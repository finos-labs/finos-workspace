import { describe, it, beforeEach } from "node:test";
import { expect } from "expect";
import { runAgentLoop } from "../../../src/agent/loop.ts";
import { withInlineToolCalls } from "../../../src/lib/inline-tool-calls.ts";
import type { QueryRequest, SSEEvent, Widget } from "../../../src/protocol/types.ts";
import { llmCallsToolWithText, llmEmitsText, llmEmitsTextInDeltas, makeSequencedMockLlm } from "../../helpers/mock-llm.ts";
import { collectGenerator } from "../../helpers/sse-reader.ts";
import { clearAllModuleState } from "../../helpers/clear-state.ts";
import { rememberRows } from "../../../src/agent/row-cache.ts";

beforeEach(() => clearAllModuleState());

const SQL = { display_summary: "Checking the top close", sql: "SELECT MAX(close) AS m FROM prices" };

async function seedPrices(chat: string): Promise<void> {
  await rememberRows(chat, "prices", [
    { symbol: "NVDA", close: 100 },
    { symbol: "AAPL", close: 200 },
  ]);
}

function ask(chat: string, model: ReturnType<typeof makeSequencedMockLlm>, allWidgets: Widget[] = []) {
  return collectGenerator(
    runAgentLoop({
      request: { messages: [{ role: "human", content: "summarize prices" }] } as QueryRequest,
      rawModelId: "openai:gpt-4o-mini",
      model,
      allWidgets,
      workspaceState: null,
      promptSuggestionsEnabled: false,
      conversationId: chat,
    }),
  );
}

const chunks = (events: SSEEvent[]): string[] =>
  events.filter((e) => e.event === "copilotMessageChunk").map((e) => (e.data as { delta: string }).delta);

const reasoning = (events: SSEEvent[]): string[] =>
  events
    .filter((e) => e.event === "copilotStatusUpdate")
    .map((e) => e.data as { message: string; group?: string })
    .filter((d) => d.group === "reasoning")
    .map((d) => d.message);

const everything = (events: SSEEvent[]): string => JSON.stringify(events);
const MARKERS = /<\/?tool_?calls?>|<function=|\[TOOL_CALLS\]/i;

const splitEvery = (text: string, size: number): string[] => {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
};

describe("the answer reaches the chat whole", () => {
  it("as one chunk, however many deltas the model wrote it in", async () => {
    const answer = "Top close is 200. NVDA closed at 100 and AAPL at 200, so AAPL has the higher close.";
    for (const size of [1, 2, 5, 17, answer.length]) {
      await seedPrices(`avr-whole-${size}`);
      const events = await ask(`avr-whole-${size}`, makeSequencedMockLlm([llmEmitsTextInDeltas(splitEvery(answer, size))]));
      expect(chunks(events)).toEqual([answer]);
    }
  });

  it("as one chunk when it is long enough that the text sink works on it in slices", async () => {
    const answer = `${"NVDA closed at 100 and AAPL at 200, so AAPL has the higher close. ".repeat(400)}Done.`;
    expect(answer.length).toBeGreaterThan(20_000);
    await seedPrices("avr-long");
    const events = await ask("avr-long", makeSequencedMockLlm([llmEmitsTextInDeltas(splitEvery(answer, 1000))]));
    expect(chunks(events)).toEqual([answer]);
  });

  it("as one chunk after a chain of tool steps, and the steps' text is not in it", async () => {
    await seedPrices("avr-chain");
    const events = await ask(
      "avr-chain",
      makeSequencedMockLlm([
        llmCallsToolWithText("execute_sql", SQL, "First I will look at the highest close."),
        llmCallsToolWithText("execute_sql", { ...SQL, display_summary: "Checking again" }, "Now I will check it against the lowest."),
        llmEmitsTextInDeltas(["The top ", "close is ", "200."]),
      ]),
    );
    expect(chunks(events)).toEqual(["The top close is 200."]);
    expect(reasoning(events)).toContain("First I will look at the highest close.");
    expect(reasoning(events)).toContain("Now I will check it against the lowest.");
  });

  it("with a placeholder tag split across the deltas still stripped, in one chunk", async () => {
    await seedPrices("avr-tag");
    const events = await ask(
      "avr-tag",
      makeSequencedMockLlm([llmEmitsTextInDeltas(["Here is the chart. <arti", 'fact id="a1"/>', " NVDA is at 100."])]),
    );
    const out = chunks(events);
    expect(out).toHaveLength(1);
    expect(out[0]).not.toContain("<artifact");
    expect(out[0]).toContain("NVDA is at 100.");
  });
});

describe("text in a step that calls a tool is reasoning", () => {
  it("is one status however many deltas it came in, and never a chunk", async () => {
    await seedPrices("avr-reasoning-deltas");
    const intent = "I will look at the highest close before I answer.";
    const events = await ask(
      "avr-reasoning-deltas",
      makeSequencedMockLlm([
        { textDeltas: splitEvery(intent, 3), toolCalls: [{ toolName: "execute_sql", input: SQL }], finishReason: "tool-calls" },
        llmEmitsText("Top close is 200."),
      ]),
    );
    expect(reasoning(events).filter((m) => m === intent)).toHaveLength(1);
    expect(chunks(events)).toEqual(["Top close is 200."]);
    expect(chunks(events).join("")).not.toContain("highest close");
  });

  it("is cleaned like the answer: no placeholder tag and no suggestions block reaches the reasoning", async () => {
    await seedPrices("avr-reasoning-clean");
    const events = await ask(
      "avr-reasoning-clean",
      makeSequencedMockLlm([
        llmCallsToolWithText(
          "execute_sql",
          SQL,
          'Checking the close <artifact id="a1"/> now. <suggestions><suggestion>x</suggestion></suggestions>',
        ),
        llmEmitsText("Top close is 200."),
      ]),
    );
    const shown = reasoning(events).join("\n");
    expect(shown).toContain("Checking the close");
    expect(shown).not.toContain("<artifact");
    expect(shown).not.toContain("<suggestion");
  });

  it("is left out when it is too short to say anything, and is not repeated", async () => {
    await seedPrices("avr-reasoning-short");
    const events = await ask(
      "avr-reasoning-short",
      makeSequencedMockLlm([
        llmCallsToolWithText("execute_sql", SQL, "Ok."),
        llmCallsToolWithText("execute_sql", { ...SQL, display_summary: "Again" }, "Looking at the top close."),
        llmCallsToolWithText("execute_sql", { ...SQL, display_summary: "Once more" }, "Looking at the top close."),
        llmEmitsText("Top close is 200."),
      ]),
    );
    expect(reasoning(events).filter((m) => m === "Ok.")).toHaveLength(0);
    expect(reasoning(events).filter((m) => m === "Looking at the top close.")).toHaveLength(1);
  });

  it("is shown before the tool it introduced, and before the answer", async () => {
    await seedPrices("avr-order");
    const events = await ask(
      "avr-order",
      makeSequencedMockLlm([llmCallsToolWithText("execute_sql", SQL, "Looking at the top close."), llmEmitsText("Top close is 200.")]),
    );
    const intent = events.findIndex((e) => e.event === "copilotStatusUpdate" && (e.data as { message?: string }).message === "Looking at the top close.");
    const tool = events.findIndex((e) => e.event === "copilotStatusUpdate" && JSON.stringify(e.data).includes("execute_sql"));
    const answer = events.findIndex((e) => e.event === "copilotMessageChunk");
    expect(intent).toBeGreaterThanOrEqual(0);
    expect(tool).toBeGreaterThan(intent);
    expect(answer).toBeGreaterThan(tool);
  });
});

describe("a model that writes its tool calls into its text", () => {
  const marker = (name: string, args: unknown) => `<tool_call>${JSON.stringify({ name, arguments: args })}</tool_call>`;
  const inline = (steps: Parameters<typeof makeSequencedMockLlm>[0]) =>
    withInlineToolCalls(makeSequencedMockLlm(steps) as never) as unknown as ReturnType<typeof makeSequencedMockLlm>;

  it("has its marker run as the tool call, its text before it shown as reasoning, and no marker shown", async () => {
    await seedPrices("avr-inline");
    const text = `I will look at the highest close first. ${marker("execute_sql", SQL)}`;
    const events = await ask(
      "avr-inline",
      inline([llmEmitsTextInDeltas(splitEvery(text, 4)), llmEmitsTextInDeltas(["Top close ", "is 200."])]),
    );
    expect(JSON.stringify(events)).toContain("execute_sql");
    expect(chunks(events)).toEqual(["Top close is 200."]);
    expect(reasoning(events)).toContain("I will look at the highest close first.");
    expect(everything(events)).not.toMatch(MARKERS);
    expect([...reasoning(events), ...chunks(events)].join("\n")).not.toContain("SELECT");
  });

  it("runs several markers of one step", async () => {
    await seedPrices("avr-inline-many");
    const events = await ask(
      "avr-inline-many",
      inline([
        llmEmitsText(`Two looks at the prices. ${marker("execute_sql", SQL)} ${marker("execute_sql", { ...SQL, display_summary: "Second look" })}`),
        llmEmitsText("Top close is 200."),
      ]),
    );
    const sqlStatuses = events.filter((e) => e.event === "copilotStatusUpdate" && JSON.stringify(e.data).includes("execute_sql"));
    expect(sqlStatuses.length).toBeGreaterThanOrEqual(2);
    expect(chunks(events)).toEqual(["Top close is 200."]);
    expect(everything(events)).not.toMatch(MARKERS);
  });

  it("hands a round-trip tool to the FINOS Workspace the same as a native call would be", async () => {
    const widget: Widget = { uuid: "w-inline", origin: "example", widget_id: "wid", name: "Prices", description: "", params: [] } as Widget;
    const events = await ask(
      "avr-inline-roundtrip",
      inline([llmEmitsText(`Let me load the widget. ${marker("get_widget_data", { widgets: [{ widget_uuid: "w-inline" }] })}`)]),
      [widget],
    );
    const call = events.find((e) => e.event === "copilotFunctionCall" && (e.data as { function?: string }).function === "get_widget_data");
    expect(call).toBeDefined();
    expect(JSON.stringify(call)).toContain("w-inline");
    expect(chunks(events)).toEqual([]);
    expect(everything(events)).not.toMatch(MARKERS);
  });

  it("drops a marker for a tool that does not exist, and a marker that cannot be read, instead of showing it", async () => {
    await seedPrices("avr-inline-bad");
    const events = await ask(
      "avr-inline-bad",
      inline([
        llmEmitsText(`The close is 200. ${marker("rm_rf", { path: "/" })} <tool_call>{broken`),
      ]),
    );
    expect(chunks(events).map((c) => c.trim())).toEqual(["The close is 200."]);
    expect(everything(events)).not.toContain("rm_rf");
    expect(everything(events)).not.toMatch(MARKERS);
    expect(everything(events)).not.toContain("broken");
    expect(everything(events)).not.toContain("tool_call>");
  });

  it("shows an answer that talks about markers, without a marker in it, as the answer", async () => {
    await seedPrices("avr-inline-prose");
    const events = await ask(
      "avr-inline-prose",
      inline([llmEmitsText("In HTML, <function> and <tool> are just tags; P/E < 15 is cheap.")]),
    );
    expect(chunks(events)).toEqual(["In HTML, <function> and <tool> are just tags; P/E < 15 is cheap."]);
  });
});
