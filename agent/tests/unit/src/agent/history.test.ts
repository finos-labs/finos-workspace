import { describe, it, expect } from "bun:test";
import type { Message } from "../../../../src/protocol/types";
import {
  conversationNote,
  currentTurnStart,
  earlierEntries,
  sanitizeAssistantContent,
  transcriptOf,
} from "../../../../src/agent/history";

const human = (content: string): Message => ({ role: "human", content });
const ai = (content: string): Message => ({ role: "ai", content });
const toolResult: Message = {
  role: "tool",
  function: "execute_agent_tool",
  input_arguments: { tool_name: "web_search" },
  data: [{ items: [{ text: "results" }] }],
};

describe("currentTurnStart", () => {
  it("is the user's last message", () => {
    expect(currentTurnStart([human("a"), ai("b"), human("c"), toolResult])).toBe(2);
  });

  it("is the start when nobody has spoken", () => {
    expect(currentTurnStart([ai("b"), toolResult])).toBe(0);
    expect(currentTurnStart([])).toBe(0);
  });
});

describe("transcriptOf", () => {
  it("numbers what the user wrote and what the agent answered, and leaves out the rest", () => {
    const entries = transcriptOf([
      human("first"),
      ai(JSON.stringify({ function: "get_widget_data", input_arguments: { data_sources: [] } })),
      toolResult,
      ai("an answer"),
      ai("   "),
      human("second"),
    ]);
    expect(entries.map((e) => [e.number, e.role, e.text])).toEqual([
      [1, "user", "first"],
      [2, "assistant", "an answer"],
      [3, "user", "second"],
    ]);
  });

  it("remembers where each message is in the request", () => {
    const entries = transcriptOf([human("a"), toolResult, ai("b")]);
    expect(entries.map((e) => e.source)).toEqual([0, 2]);
  });
});

describe("earlierEntries", () => {
  it("is what came before the current turn", () => {
    const earlier = earlierEntries([human("a"), ai("b"), human("c"), ai("d"), human("e"), toolResult]);
    expect(earlier.map((e) => e.text)).toEqual(["a", "b", "c", "d"]);
  });

  it("is nothing in the first turn", () => {
    expect(earlierEntries([human("a"), toolResult])).toEqual([]);
  });
});

describe("conversationNote", () => {
  it("is nothing when there is nothing earlier", () => {
    expect(conversationNote([])).toBeNull();
  });

  it("says how many earlier messages there are and what was asked last, newest last", () => {
    const entries = transcriptOf([human("What is AAPL revenue?"), ai("It is X."), human("And margins?"), ai("Y."), human("now")]);
    const note = conversationNote(earlierEntries([human("What is AAPL revenue?"), ai("It is X."), human("And margins?"), ai("Y."), human("now")]))!;
    expect(entries).toHaveLength(5);
    expect(note).toContain("4 earlier messages (numbered 1-4)");
    expect(note).toContain('#1 "What is AAPL revenue?"');
    expect(note).toContain('#3 "And margins?"');
    expect(note.indexOf("#1")).toBeLessThan(note.indexOf("#3"));
    expect(note).not.toContain("It is X.");
    expect(note).toContain("recall_conversation");
  });

  it("lists only the last eight questions, each cut to one short line", () => {
    const messages: Message[] = [];
    for (let i = 1; i <= 20; i++) messages.push(human(`question ${i} ${"word ".repeat(80)}`), ai(`answer ${i}`));
    messages.push(human("current"));
    const note = conversationNote(earlierEntries(messages))!;
    const listed = note.split("\n").filter((line) => line.startsWith("#"));
    expect(listed).toHaveLength(8);
    expect(listed[0]).toContain("question 13");
    expect(listed.at(-1)).toContain("question 20");
    for (const line of listed) expect(line.length).toBeLessThan(140);
    expect(note.length).toBeLessThan(2500);
  });

  it("has a size that does not depend on how long the conversation is", () => {
    const build = (pairs: number) => {
      const messages: Message[] = [];
      for (let i = 1; i <= pairs; i++) messages.push(human(`question ${i}`), ai(`answer ${i} ${"x".repeat(500)}`));
      messages.push(human("current"));
      return conversationNote(earlierEntries(messages))!.length;
    };
    expect(Math.abs(build(1000) - build(20))).toBeLessThan(40);
  });
});

describe("sanitizeAssistantContent", () => {
  it("drops a tool-call envelope and keeps prose", () => {
    expect(sanitizeAssistantContent(JSON.stringify({ function: "x", input_arguments: {} }))).toBeNull();
    expect(sanitizeAssistantContent("  plain text ")).toBe("plain text");
    expect(sanitizeAssistantContent("")).toBeNull();
  });
});
