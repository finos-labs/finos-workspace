/**
 * Tier 2 — a search of a PDF is cited at the pages the answer names.
 *
 * `query_documents` reports every page it handed to the model, with how well each matched. The loop cites
 * the pages that the answer the user reads says it rests on, as the file widget at that page, and carries
 * the reported pages across round trips until there is an answer to read them against.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { runAgentLoop } from "../../../src/agent/loop";
import type { AgentTool, Citation, QueryRequest, SSEEvent, ToolMessage, Widget } from "../../../src/protocol/types";
import { llmCallsTool, llmEmitsText, makeMockLlm } from "../../helpers/mock-llm";
import { collectGenerator } from "../../helpers/sse-reader";
import { clearAllModuleState } from "../../helpers/clear-state";

beforeEach(() => clearAllModuleState());

const pdf: Widget = {
  uuid: "pdf-1",
  origin: "the backend",
  widget_id: "file-pdf-1",
  name: "Project Kestrel Plan",
  description: "",
  params: [],
  metadata: { extension: "pdf", originalFileName: "kestrel-plan.pdf" },
};

const searchTool: AgentTool = {
  name: "query_documents",
  tool_name: "query_documents",
  server_id: "ines-tools",
  url: "http://ines-mcp:8787/mcp",
  description: "Search documents",
  input_schema: { properties: { query: { type: "string" } }, required: ["query"] },
};

const hit = (page: number, score: number) => ({
  text: JSON.stringify({
    $ines_kind: "citation",
    citation: { type: "document", id: "pdf-1", uri: "ines-doc://c/pdf-1", title: "Project Kestrel Plan", page, score },
  }),
});

function searchResult(extra_state?: Record<string, unknown>): ToolMessage {
  return {
    role: "tool",
    function: "execute_agent_tool",
    input_arguments: { tool_name: "query_documents", server_id: "ines-tools" },
    data: [
      {
        items: [
          { text: "### Hit 1 — Project Kestrel Plan p.2\nBudget. The approved marketing budget is 731 thousand dollars." },
          hit(2, 0.58),
          hit(1, 0.08),
          hit(3, 0.07),
        ],
      },
    ],
    ...(extra_state ? { extra_state } : {}),
  } as unknown as ToolMessage;
}

async function run(messages: unknown[], model: ReturnType<typeof makeMockLlm>, tools: AgentTool[] = [searchTool]) {
  return collectGenerator(
    runAgentLoop({
      request: { messages, tools, widgets: { primary: [pdf], secondary: [], extra: [] } } as unknown as QueryRequest,
      rawModelId: "test-provider:test-model",
      model,
      allWidgets: [pdf],
      workspaceState: null,
      generativeUiEnabled: false,
      conversationId: "doc-cites",
      promptSuggestionsEnabled: true,
    }),
  );
}

const citationsOf = (events: SSEEvent[]): Citation[] =>
  (events.find((e) => e.event === "copilotCitationCollection")?.data as { citations: Citation[] } | undefined)?.citations ?? [];
const pagesOf = (citations: Citation[]) => citations.map((c) => c.details[0].Page).sort();

describe("the pages cited for a search of a PDF", () => {
  it("are the pages the answer names, as the file widget at that page", async () => {
    const events = await run(
      [{ role: "human", content: "What is the budget?" }, searchResult()],
      makeMockLlm(llmEmitsText("The approved marketing budget is $731,000 (page 2).")),
    );
    const cits = citationsOf(events);
    expect(pagesOf(cits)).toEqual([2]);
    expect(cits[0].source_info).toMatchObject({ type: "widget", uuid: "pdf-1", origin: "the backend", widget_id: "file-pdf-1" });
    expect(cits[0].details[0]).toMatchObject({ Filename: "kestrel-plan.pdf", Extension: "pdf", Page: 2 });
  });

  it("do not include a page that only a follow-up suggestion names", async () => {
    const events = await run(
      [{ role: "human", content: "What is the budget?" }, searchResult()],
      makeMockLlm(
        llmEmitsText(
          "The approved marketing budget is $731,000 (page 2).\n\n" +
            "<suggestions><suggestion>What is the supplier delay risk on page 3?</suggestion></suggestions>",
        ),
      ),
    );
    expect(pagesOf(citationsOf(events))).toEqual([2]);
  });

  it("include each page the answer names", async () => {
    const events = await run(
      [{ role: "human", content: "Budget and risk?" }, searchResult()],
      makeMockLlm(llmEmitsText("Budget: $731,000 (page 2). Supplier delay: 9 weeks (page 3).")),
    );
    expect(pagesOf(citationsOf(events))).toEqual([2, 3]);
  });

  it("are the best matches when the answer names no page", async () => {
    const events = await run(
      [{ role: "human", content: "What is the budget?" }, searchResult()],
      makeMockLlm(llmEmitsText("The approved marketing budget is $731,000.")),
    );
    expect(pagesOf(citationsOf(events))).toEqual([2]);
  });

  it("are carried across a round trip as they were reported, to be chosen from the final answer", async () => {
    const events = await run(
      [{ role: "human", content: "Budget, then fetch something" }, searchResult()],
      makeMockLlm(llmCallsTool("query_documents", { query: "supplier delay" })),
    );
    const call = events.find((e) => e.event === "copilotFunctionCall" && (e.data as { function?: string }).function === "execute_agent_tool");
    const extra = (call!.data as { extra_state?: { document_hits?: { page: number }[]; intermediate_citations?: Citation[] } }).extra_state;
    expect(extra?.document_hits?.map((h) => h.page).sort()).toEqual([1, 2, 3]);
    // Not chosen yet: no page of the document is cited as it stands.
    expect(extra?.intermediate_citations?.some((c) => c.details[0]?.Page != null) ?? false).toBe(false);
  });

  it("are chosen from the final answer after a second search, from the pages of both", async () => {
    const hitsOfFirst = [2, 1, 3].map((page, i) => ({ id: "pdf-1", type: "document", uri: "u", title: "Project Kestrel Plan", page, score: [0.58, 0.08, 0.07][i] }));
    const events = await run(
      [
        { role: "human", content: "Budget and risk?" },
        searchResult({ document_hits: hitsOfFirst }),
      ],
      makeMockLlm(llmEmitsText("Budget (page 2); supplier delay (page 3).")),
    );
    // The first search's pages are restored and the second's are added; the pages are cited once each.
    expect(pagesOf(citationsOf(events))).toEqual([2, 3]);
  });

  it("are the whole file when there is no page to name", async () => {
    const events = await run(
      [
        { role: "human", content: "Summarise the file" },
        {
          role: "tool",
          function: "execute_agent_tool",
          input_arguments: { tool_name: "query_documents", server_id: "ines-tools" },
          data: [
            {
              items: [
                { text: "### Hit 1 — notes.txt\nsome text" },
                { text: JSON.stringify({ $ines_kind: "citation", citation: { type: "document", id: "pdf-1", uri: "u", title: "Project Kestrel Plan", score: 0.5 } }) },
              ],
            },
          ],
        } as unknown as ToolMessage,
      ],
      makeMockLlm(llmEmitsText("It is a short plan.")),
    );
    const cits = citationsOf(events);
    expect(cits).toHaveLength(1);
    expect(cits[0].details[0]).toEqual({ Filename: "kestrel-plan.pdf", Extension: "pdf" });
  });
});
