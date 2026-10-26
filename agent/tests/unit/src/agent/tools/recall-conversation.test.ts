import { describe, it } from "node:test";
import { expect } from "expect";
import type { Message } from "../../../../../src/protocol/types.ts";
import { earlierEntries } from "../../../../../src/agent/history.ts";
import { makeRecallConversationTool } from "../../../../../src/agent/tools/recall-conversation.ts";
import { renderMetrics } from "../../../../../src/lib/metrics.ts";

const human = (content: string): Message => ({ role: "human", content });
const ai = (content: string): Message => ({ role: "ai", content });

/** A chat of numbered questions and answers, then the current question. */
function chat(pairs: number): Message[] {
  const messages: Message[] = [];
  for (let k = 1; k <= pairs; k++) {
    messages.push(
      human(`Question ${k}: what is the project code for workstream ${k}?`),
      ai(`The project code for workstream ${k} is ZK-${k * 7}. The review covered revenue, margins and supplier risk.`),
    );
  }
  messages.push(human("the current question"));
  return messages;
}

async function recall(messages: Message[], args: Record<string, unknown> = {}): Promise<string> {
  const tool = makeRecallConversationTool(earlierEntries(messages));
  return (await tool.execute!(args as never, { toolCallId: "t", messages: [] })) as string;
}

describe("recall_conversation — the latest messages", () => {
  it("reads the previous question and its answer by default", async () => {
    const text = await recall(chat(5));
    expect(text).toContain("10 earlier messages (numbered 1-10)");
    expect(text).toContain("#9 user: Question 5");
    expect(text).toContain("#10 assistant: The project code for workstream 5 is ZK-35");
    expect(text).not.toContain("#8 ");
  });

  it("reads as many of the latest as asked for", async () => {
    const text = await recall(chat(5), { last: 4 });
    for (const n of [7, 8, 9, 10]) expect(text).toContain(`#${n} `);
    expect(text).not.toContain("#6 ");
  });

  it("never reads the current question: the model has it", async () => {
    expect(await recall(chat(2), { last: 10 })).not.toContain("the current question");
  });
});

describe("recall_conversation — search by words", () => {
  it("finds the earlier message that has the words, far back in a long chat", async () => {
    const text = await recall(chat(300), { query: "project code workstream 3" });
    const first = text.split("\n\n")[1];
    expect(first.startsWith("#5 user") || first.startsWith("#6 assistant")).toBe(true);
    expect(text).toContain("ZK-21");
  });

  it("ranks by the words that few messages have, so common words do not drown the match", async () => {
    const text = await recall(chat(50), { query: "what is the project code for workstream 42" });
    const numbers = [...text.matchAll(/^#(\d+) /gm)].map((m) => Number(m[1]));
    expect(numbers.slice(0, 2).sort()).toEqual([83, 84]);
  });

  it("returns a handful of results, with a snippet of a long message around the words", async () => {
    const long = `${"filler ".repeat(500)}the codename is Peregrine ${"filler ".repeat(500)}`;
    const text = await recall([human("a"), ai(long), human("now")], { query: "peregrine" });
    expect(text).toContain("Peregrine");
    expect(text.length).toBeLessThan(1500);
    expect((await recall(chat(30), { query: "workstream" })).match(/^#\d+ /gm)!.length).toBeLessThanOrEqual(6);
  });

  it("says when nothing matches", async () => {
    expect(await recall(chat(3), { query: "zebra" })).toContain("None of them contains those words");
  });

  it("is case-insensitive and finds a number", async () => {
    const text = await recall(chat(30), { query: "ZK-196" });
    expect(text).toContain("workstream 28");
  });
});

describe("recall_conversation — by number", () => {
  it("reads the messages from one to another", async () => {
    const text = await recall(chat(10), { from: 3, to: 5 });
    expect(text).toContain("#3 user: Question 2");
    expect(text).toContain("#5 user: Question 3");
    expect(text).not.toContain("#6 ");
  });

  it("reads one message when only a number is given", async () => {
    const text = await recall(chat(10), { from: 8 });
    expect(text).toContain("#8 assistant");
    expect(text).not.toContain("#9 ");
  });

  it("reads a few at a time, not a whole chat", async () => {
    const text = await recall(chat(100), { from: 1, to: 200 });
    expect(text.match(/^#\d+ /gm)).toHaveLength(6);
  });

  it("says when there is no such message", async () => {
    expect(await recall(chat(2), { from: 50 })).toContain("There is no message 50");
  });
});

describe("recall_conversation — limits", () => {
  it("cuts one very long message and a long result", async () => {
    const huge = "word ".repeat(20_000);
    const text = await recall([human("a"), ai(huge), human("b"), ai(huge), human("now")], { last: 4 });
    expect(text.length).toBeLessThan(21_000);
    expect(text).toContain("more characters of #");
  });

  it("says so in the first question of a conversation", async () => {
    expect(await recall([human("first")])).toContain("no earlier messages");
  });

  it("is counted, by how the model looked", async () => {
    await recall(chat(3), { query: "workstream" });
    await recall(chat(3), { from: 1 });
    await recall(chat(3));
    const text = renderMetrics();
    for (const mode of ["words", "numbers", "latest"]) {
      expect(text).toMatch(new RegExp(`ines_conversation_recalls_total\\{mode="${mode}"\\} \\d+`));
    }
  });
});
