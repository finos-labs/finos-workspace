/**
 * Tier 2 — the model is served the current turn, and reads the rest of the conversation with a tool.
 *
 * Drives the real loop with a spy model, to see exactly what it is given and what happens when it asks
 * for more.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { runAgentLoop, _resetWidgetDataCache } from "../../../src/agent/loop";
import type { QueryRequest, Message, AgentTool } from "../../../src/protocol/types";
import { llmCallsTool, llmEmitsText, makeSequencedSpyMockLlm, makeSpyMockLlm } from "../../helpers/mock-llm";
import { collectGenerator } from "../../helpers/sse-reader";
import { clearAllModuleState } from "../../helpers/clear-state";
import { modelKnowsTool } from "../../helpers/offered-tools";

beforeEach(() => {
  clearAllModuleState();
  _resetWidgetDataCache();
});

const human = (content: string): Message => ({ role: "human", content });
const ai = (content: string): Message => ({ role: "ai", content });

function longChat(pairs: number): Message[] {
  const messages: Message[] = [];
  for (let k = 1; k <= pairs; k++) {
    messages.push(
      human(`Question ${k}: what is the project code for workstream ${k}?`),
      ai(`The project code for workstream ${k} is ZK-${k * 7}. ${"The review covered revenue, margins and supplier risk. ".repeat(12)}`),
    );
  }
  return messages;
}

async function run(messages: Message[], model: ReturnType<typeof makeSpyMockLlm>["model"], tools: AgentTool[] = []) {
  return collectGenerator(
    runAgentLoop({
      request: { messages, tools } as QueryRequest,
      rawModelId: "test-provider:test-model",
      model,
      allWidgets: [],
      workspaceState: null,
      generativeUiEnabled: false,
      conversationId: "chat-1",
    }),
  );
}

const promptText = (call: { messages?: unknown }) => JSON.stringify(call.messages);
const toolNames = (call: { tools?: unknown }) => ((call.tools ?? []) as { name: string }[]).map((t) => t.name);
const chunks = (events: { event: string; data: unknown }[]) =>
  events
    .filter((e) => e.event === "copilotMessageChunk")
    .map((e) => (e.data as { delta: string }).delta)
    .join("");

describe("what the model is given", () => {
  it("is the current question and a note, however long the chat has been", async () => {
    const spy = makeSpyMockLlm(llmEmitsText("done"));
    await run([...longChat(300), human("and what is the weather?")], spy.model);
    const prompt = promptText(spy.calls[0]);
    expect(prompt).toContain("and what is the weather?");
    expect(prompt).toContain("This conversation has 600 earlier messages");
    // Nothing of the earlier answers is in what the model sees.
    expect(prompt).not.toContain("supplier risk");
    expect(prompt).not.toContain("ZK-7");
  });

  it("costs about the same at the 300th question as at the 5th", async () => {
    const small = makeSpyMockLlm(llmEmitsText("done"));
    await run([...longChat(5), human("next?")], small.model);
    const large = makeSpyMockLlm(llmEmitsText("done"));
    await run([...longChat(300), human("next?")], large.model);
    const a = promptText(small.calls[0]).length;
    const b = promptText(large.calls[0]).length;
    expect(b).toBeLessThan(a * 1.2);
  });

  it("offers the recall tool when there are earlier messages, and not in the first turn", async () => {
    const later = makeSpyMockLlm(llmEmitsText("done"));
    await run([human("a"), ai("b"), human("c")], later.model);
    expect(toolNames(later.calls[0])).toContain("recall_conversation");

    const first = makeSpyMockLlm(llmEmitsText("done"));
    await run([human("a")], first.model);
    expect(toolNames(first.calls[0])).not.toContain("recall_conversation");
    expect(promptText(first.calls[0])).not.toContain("Conversation memory");
  });
});

describe("what the model does when the question needs the rest", () => {
  it("looks an early fact up with the tool and answers from it", async () => {
    const spy = makeSequencedSpyMockLlm([
      llmCallsTool("recall_conversation", { query: "project code workstream 3" }),
      llmEmitsText("The code is ZK-21."),
    ]);
    const events = await run([...longChat(300), human("What was the code for workstream 3?")], spy.model);

    expect(chunks(events)).toBe("The code is ZK-21.");
    expect(spy.calls).toHaveLength(2);
    // What the first request had not shown, the second has: the tool's answer.
    expect(promptText(spy.calls[0])).not.toContain("ZK-21");
    expect(promptText(spy.calls[1])).toContain("ZK-21");
    expect(promptText(spy.calls[1])).toContain("workstream 3");
  });

  it("reads the previous exchange for a question that only makes sense after it", async () => {
    const spy = makeSequencedSpyMockLlm([
      llmCallsTool("recall_conversation", { last: 2 }),
      llmEmitsText("Teal."),
    ]);
    const events = await run(
      [human("My favourite colour is teal."), ai("Noted: teal."), human("What is my favourite colour?")],
      spy.model,
    );
    expect(chunks(events)).toBe("Teal.");
    expect(promptText(spy.calls[1])).toContain("My favourite colour is teal.");
  });
});

describe("what carries over from earlier turns without being shown", () => {
  const codeTool: AgentTool = {
    name: "Ines Tools_execute_code",
    tool_name: "execute_code",
    server_id: "ines-tools",
    url: "http://ines-mcp:8787/mcp",
    description: "Run Python",
    input_schema: { properties: { code: { type: "string" } }, required: ["code"] },
  };

  it("keeps the code sandbox off for the rest of the chat once a turn found it permanently unavailable", async () => {
    const spy = makeSpyMockLlm(llmEmitsText("no sandbox"));
    const earlierTurnFailure = {
      role: "tool",
      function: "execute_agent_tool",
      input_arguments: { tool_name: "execute_code", server_id: "ines-tools" },
      data: [{ items: [{ text: "COMPUTE_PERMANENTLY_UNAVAILABLE: sandbox failed" }] }],
    } as unknown as Message;
    await run([human("run python"), earlierTurnFailure, ai("It failed."), human("try again")], spy.model, [codeTool]);
    expect(modelKnowsTool(spy.calls[0], "execute_code")).toBe(false);
    // The failure itself is not in what the model was given: it is a turn the model is not shown.
    expect(promptText(spy.calls[0])).not.toContain("COMPUTE_PERMANENTLY_UNAVAILABLE");
  });

  it("offers the sandbox as before when nothing failed", async () => {
    const spy = makeSpyMockLlm(llmEmitsText("ok"));
    await run([human("a"), ai("b"), human("run python")], spy.model, [codeTool]);
    expect(modelKnowsTool(spy.calls[0], "execute_code")).toBe(true);
  });
});
