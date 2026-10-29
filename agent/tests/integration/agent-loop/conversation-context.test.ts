import { describe, it, beforeEach } from "node:test";
import { expect } from "expect";
import { runAgentLoop } from "../../../src/agent/loop.ts";
import type { QueryRequest, Message, AgentTool } from "../../../src/protocol/types.ts";
import { llmCallsTool, llmEmitsText, makeSequencedSpyMockLlm, makeSpyMockLlm } from "../../helpers/mock-llm.ts";
import { collectGenerator } from "../../helpers/sse-reader.ts";
import { clearAllModuleState } from "../../helpers/clear-state.ts";

beforeEach(() => {
  clearAllModuleState();
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
