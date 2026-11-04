import { describe, it, beforeEach } from "node:test";
import { expect } from "expect";
import { runAgentLoop } from "../../../src/agent/loop.ts";
import { makePluginArtifactTool } from "../../../src/agent/tools/plugin-artifact.ts";
import type { PluginArtifactEntry, QueryRequest, SSEEvent } from "../../../src/protocol/types.ts";
import { llmCallsTool, llmEmitsText, makeSequencedMockLlm } from "../../helpers/mock-llm.ts";
import { collectGenerator } from "../../helpers/sse-reader.ts";
import { clearAllModuleState } from "../../helpers/clear-state.ts";

beforeEach(() => clearAllModuleState());

const bars: PluginArtifactEntry = {
  plugin: "chart-kit",
  widget: "bars",
  name: "Bars",
  description: "Bars of x labels and y values",
  data_schema: {
    type: "object",
    additionalProperties: false,
    required: ["rows"],
    properties: {
      rows: {
        type: "array",
        items: { type: "object", required: ["x", "y"], properties: { x: { type: "string" }, y: { type: "number" } } },
      },
    },
  },
};

const request = (): QueryRequest =>
  ({
    messages: [{ role: "human", content: "chart the monthly sales" }],
    plugin_artifacts: [bars],
  }) as QueryRequest;

describe("show_plugin_artifact in the agent loop", () => {
  it("emits a plugin artifact without a round trip, and the model answers after it", async () => {
    const events = await collectGenerator(
      runAgentLoop({
        request: request(),
        rawModelId: "openai:gpt-4o-mini",
        model: makeSequencedMockLlm([
          llmCallsTool("show_plugin_artifact", {
            component: "chart-kit/bars",
            name: "Monthly sales",
            data: { rows: [{ x: "jan", y: 3 }] },
          }),
          llmEmitsText("Here are the monthly sales."),
        ]),
        allWidgets: [],
        workspaceState: null,
        conversationId: "plugin-artifact-1",
      }),
    );

    const artifact = events.find((e) => e.event === "copilotMessageArtifact");
    expect(artifact).toBeDefined();
    expect(artifact!.data).toMatchObject({
      type: "plugin",
      name: "Monthly sales",
      plugin: { id: "chart-kit", widget: "bars" },
      data: { rows: [{ x: "jan", y: 3 }] },
    });
    expect(events.some((e) => e.event === "copilotFunctionCall")).toBe(false);
  });

  it("is not offered when the request names no plugin component", async () => {
    const events = await collectGenerator(
      runAgentLoop({
        request: { messages: [{ role: "human", content: "chart the monthly sales" }] } as QueryRequest,
        rawModelId: "openai:gpt-4o-mini",
        model: makeSequencedMockLlm([
          llmCallsTool("show_plugin_artifact", { component: "chart-kit/bars", name: "x", data: { rows: [] } }),
          llmEmitsText("I cannot."),
        ]),
        allWidgets: [],
        workspaceState: null,
        conversationId: "plugin-artifact-2",
      }),
    );

    expect(events.some((e) => e.event === "copilotMessageArtifact")).toBe(false);
  });
});

describe("show_plugin_artifact with rows from the loaded tables", () => {
  it("reads them in the isolated child, so they never pass through the model", async () => {
    const artifactQueue: SSEEvent[] = [];
    const pendingTables = new Map<string, Record<string, unknown>[]>([
      ["sales", Array.from({ length: 300 }, (_, i) => ({ x: `m${i}`, y: i }))],
    ]);
    const set = makePluginArtifactTool({ catalog: [bars], pendingTables, artifactQueue });

    const out = String(
      await (set as unknown as { execute: (a: unknown, o: unknown) => Promise<unknown> }).execute(
        { component: "chart-kit/bars", name: "Sales", sql: "SELECT x, y FROM sales WHERE y >= 100", rows_key: "rows" },
        { toolCallId: "1", messages: [] },
      ),
    );

    expect(out).toContain("Showed Bars");
    expect(artifactQueue).toHaveLength(1);
    const data = (artifactQueue[0].data as unknown as { data: { rows: unknown[] } }).data;
    expect(data.rows).toHaveLength(200);
  });
});
