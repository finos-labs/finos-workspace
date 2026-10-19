/**
 * Ines's own skills (src/skills/) are read by the agent; the user's skills
 * come from the Workspace with a `get_skill_content` round trip.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { runAgentLoop } from "../../../src/agent/loop";
import type { QueryRequest, SSEEvent } from "../../../src/protocol/types";
import { llmCallsTool, llmEmitsText, makeSequencedSpyMockLlm } from "../../helpers/mock-llm";
import { collectGenerator } from "../../helpers/sse-reader";
import { clearAllModuleState } from "../../helpers/clear-state";

beforeEach(() => clearAllModuleState());

function findFunctionCall(events: SSEEvent[], fn: string): SSEEvent | undefined {
  return events.find(
    (e) => e.event === "copilotFunctionCall" && (e.data as { function?: string }).function === fn,
  );
}

const statusMessages = (events: SSEEvent[]): string[] =>
  events
    .filter((e) => e.event === "copilotStatusUpdate")
    .map((e) => String((e.data as { message?: unknown }).message ?? ""));

describe("Ines's own skills", () => {
  it("are listed to the model and read without a round trip", async () => {
    const spy = makeSequencedSpyMockLlm([
      llmCallsTool("get_skill_content", { slug: "html-chart" }),
      llmEmitsText("Here is the chart."),
    ]);
    const events = await collectGenerator(
      runAgentLoop({
        request: { messages: [{ role: "human", content: "chart revenue" }] } as QueryRequest,
        rawModelId: "openai:gpt-4o-mini",
        model: spy.model,
        allWidgets: [],
        workspaceState: null,
        conversationId: "ines-skill",
      }),
    );

    expect(findFunctionCall(events, "get_skill_content")).toBeUndefined();
    expect(statusMessages(events)).toContain('Skill "html-chart" loaded');
    expect(JSON.stringify(spy.calls[0].messages)).toContain('slug=\\"html-chart\\"');
    expect(JSON.stringify(spy.calls.at(-1)?.messages)).toContain("Workspace chart colors skill");
  });

  it("give way to a user's skill of the same slug, which the Workspace loads", async () => {
    const spy = makeSequencedSpyMockLlm([llmCallsTool("get_skill_content", { slug: "html-chart" })]);
    const events = await collectGenerator(
      runAgentLoop({
        request: {
          messages: [{ role: "human", content: "chart revenue" }],
          skills_catalog: [{ slug: "html-chart", description: "my charts", updatedAt: "" }],
        } as QueryRequest,
        rawModelId: "openai:gpt-4o-mini",
        model: spy.model,
        allWidgets: [],
        workspaceState: null,
        conversationId: "user-skill",
      }),
    );

    const call = findFunctionCall(events, "get_skill_content");
    expect(call).toBeDefined();
    expect((call!.data as { input_arguments?: { slug?: string } }).input_arguments?.slug).toBe("html-chart");
  });
});
