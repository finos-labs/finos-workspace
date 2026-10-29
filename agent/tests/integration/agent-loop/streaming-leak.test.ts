import { describe, it, beforeEach } from "node:test";
import { expect } from "expect";
import { runAgentLoop } from "../../../src/agent/loop.ts";
import type { QueryRequest, SSEEvent } from "../../../src/protocol/types.ts";
import { llmEmitsTextInDeltas, makeMockLlm } from "../../helpers/mock-llm.ts";
import { collectGenerator } from "../../helpers/sse-reader.ts";
import { clearAllModuleState } from "../../helpers/clear-state.ts";

beforeEach(() => clearAllModuleState());

function chunkText(events: SSEEvent[]): string {
  return events
    .filter((e) => e.event === "copilotMessageChunk")
    .map((e) => (e.data as { delta: string }).delta)
    .join("");
}

describe("streaming — placeholder tags never reach the user", () => {
  it("regression: strips `<artifact_id:UUID>` from the delta even if the model emits it", async () => {
    const events = await collectGenerator(
      runAgentLoop({
        request: { messages: [{ role: "human", content: "go" }] } as QueryRequest,
        rawModelId: "openai:gpt-4o-mini",
        model: makeMockLlm(
          llmEmitsTextInDeltas([
            "Result: <arti",
            "fact_id:abcd-1234>see chart</arti",
            "fact_id> done.",
          ]),
        ),
        allWidgets: [],
        workspaceState: null,
        conversationId: "leak-1",
      }),
    );
    const text = chunkText(events);
    expect(text).not.toMatch(/<\/?artifact_id/i);
    expect(text).toContain("Result:");
    expect(text).toContain("done.");
    expect(text).toContain("see chart");
  });

  it("regression: strips `<copilot_table:…>` and `<ines_artifact…>` tag styles", async () => {
    const events = await collectGenerator(
      runAgentLoop({
        request: { messages: [{ role: "human", content: "go" }] } as QueryRequest,
        rawModelId: "openai:gpt-4o-mini",
        model: makeMockLlm(
          llmEmitsTextInDeltas([
            "A <copilot_",
            'table:7>foo B <ines_artifact id="x">bar</ines_arti',
            "fact> end",
          ]),
        ),
        allWidgets: [],
        workspaceState: null,
        conversationId: "leak-2",
      }),
    );
    const text = chunkText(events);
    expect(text).not.toMatch(/<\/?copilot_table/i);
    expect(text).not.toMatch(/<\/?ines_artifact/i);
    expect(text).toContain("foo B ");
    expect(text).toContain("bar");
  });

  it("ordinary prose containing the word 'artifact' is left intact", async () => {
    const events = await collectGenerator(
      runAgentLoop({
        request: { messages: [{ role: "human", content: "go" }] } as QueryRequest,
        rawModelId: "openai:gpt-4o-mini",
        model: makeMockLlm(
          llmEmitsTextInDeltas([
            "The artifact has ",
            "rendered. Reference its ",
            "uuid for follow-up.",
          ]),
        ),
        allWidgets: [],
        workspaceState: null,
        conversationId: "leak-3",
      }),
    );
    const text = chunkText(events);
    expect(text).toContain("The artifact has rendered.");
  });

  it("strips hallucinated inline image placeholders from final text", async () => {
    const events = await collectGenerator(
      runAgentLoop({
        request: { messages: [{ role: "human", content: "go" }] } as QueryRequest,
        rawModelId: "openai:gpt-4o-mini",
        model: makeMockLlm(
          llmEmitsTextInDeltas([
            "**Trend**\n\n<img src=\"data:image/png;",
            "base64,...\" alt=\"Trend\" ",
            "/>\n\nDone.",
          ]),
        ),
        allWidgets: [],
        workspaceState: null,
        conversationId: "leak-4",
      }),
    );
    const text = chunkText(events);
    expect(text).toContain("**Trend**");
    expect(text).toContain("Done.");
    expect(text).not.toContain("<img");
    expect(text).not.toContain("data:image");
  });
});
