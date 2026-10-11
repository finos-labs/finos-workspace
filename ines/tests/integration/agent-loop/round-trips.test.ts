/**
 * Tier 2 — agent-loop round-trip scenarios.
 *
 * Pinned to CLAUDE.md gotchas:
 * - Generative UI tools are terminal (no re-POST data injection expected)
 * - Cache-resolved widget re-fetch within MAX_LOOPS=3 without HTTP round-trip
 * - Citations forwarded across round-trips (commit 63272c8)
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { runAgentLoop } from "../../../src/agent/loop";
import type { Citation, QueryRequest, ToolMessage, Widget } from "../../../src/protocol/types";
import {
  llmCallsTool,
  llmEmitsText,
  makeMockLlm,
} from "../../helpers/mock-llm";
import { collectGenerator } from "../../helpers/sse-reader";
import { clearAllModuleState } from "../../helpers/clear-state";

beforeEach(() => clearAllModuleState());

describe("generative UI is terminal — emits SSE then returns, no continuing loop", () => {
  it("add_generative_widget emits a function call and ends the turn", async () => {
    const events = await collectGenerator(
      runAgentLoop({
        request: {
          messages: [{ role: "human", content: "make a widget" }],
          workspace_options: ["generative-ui"],
        } as unknown as QueryRequest,
        rawModelId: "openai:gpt-4o-mini",
        model: makeMockLlm(
          llmCallsTool("add_generative_widget", {
            widget_type: "note",
            data: "hello",
            name: "n",
            description: "d",
          }),
        ),
        allWidgets: [],
        workspaceState: null,
        generativeUiEnabled: true,
        conversationId: "gu-1",
      }),
    );
    const fnCall = events.find(
      (e) =>
        e.event === "copilotFunctionCall" &&
        (e.data as { function?: string }).function === "add_generative_widget",
    );
    expect(fnCall).toBeDefined();
    // Terminal: no execute_agent_tool follow-on emitted.
    expect(
      events.find(
        (e) =>
          e.event === "copilotFunctionCall" &&
          (e.data as { function?: string }).function === "execute_agent_tool",
      ),
    ).toBeUndefined();
  });
});

describe("citations — forwarded across round-trips via extra_state.intermediate_citations", () => {
  it("a tool re-POST whose extra_state carries intermediate_citations re-emits them in the final collection", async () => {
    const stashed: Citation = {
      id: "stable-id-1",
      source_info: { type: "web", name: "Source A", citable: true },
      details: [{ link: "https://example.com", title: "Source A" }],
      signature: "",
    };
    const priorTool: ToolMessage = {
      role: "tool",
      function: "execute_agent_tool",
      input_arguments: { tool_name: "fetch_webpage", server_id: "ines" },
      data: [{ items: [{ text: "page body" }] }],
      extra_state: { intermediate_citations: [stashed] },
    };
    const events = await collectGenerator(
      runAgentLoop({
        request: {
          messages: [
            { role: "human", content: "summarize" },
            priorTool,
          ],
        } as unknown as QueryRequest,
        rawModelId: "openai:gpt-4o-mini",
        model: makeMockLlm(llmEmitsText("here is the summary")),
        allWidgets: [],
        workspaceState: null,
        generativeUiEnabled: false,
        conversationId: "cit-c",
      }),
    );
    const cits = events.find((e) => e.event === "copilotCitationCollection");
    expect(cits).toBeDefined();
    const list = (cits!.data as { citations: Citation[] }).citations;
    expect(list.find((c) => c.id === "stable-id-1")).toBeDefined();
  });
});
