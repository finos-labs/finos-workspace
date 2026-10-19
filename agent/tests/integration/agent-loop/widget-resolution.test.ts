/**
 * Tier 2 — get_widget_data identifier resolution.
 *
 * The loop matches only the canonical widget `uuid` and logs a warning when
 * the model supplies an identifier that is not fetchable in the current
 * request. These tests pin that lean dispatch contract.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { cacheWidgetItemsFromReboot, runAgentLoop } from "../../../src/agent/loop";
import type { QueryRequest, SSEEvent, ToolMessage, Widget } from "../../../src/protocol/types";
import {
  llmCallsTool,
  llmCallsToolWithText,
  llmEmitsText,
  makeMockLlm,
  makeSequencedMockLlm,
  makeSequencedSpyMockLlm,
  makeSpyMockLlm,
} from "../../helpers/mock-llm";
import { collectGenerator } from "../../helpers/sse-reader";
import { clearAllModuleState } from "../../helpers/clear-state";
import { getCachedRows, rememberRows } from "../../../src/agent/row-cache";
import { getTieredWidgets } from "../../../src/widgets/tiers";

beforeEach(() => clearAllModuleState());

function widget(overrides: Partial<Widget> = {}): Widget {
  return {
    uuid: "u-canonical",
    origin: "example",
    widget_id: "wid-fallback",
    name: "Resolved Widget",
    description: "",
    params: [],
    ...overrides,
  };
}

function findGetWidgetData(events: SSEEvent[]): SSEEvent | undefined {
  return events.find(
    (e) =>
      e.event === "copilotFunctionCall" &&
      (e.data as { function?: string }).function === "get_widget_data",
  );
}

function capturedToolNames(tools: unknown): string[] {
  if (!tools) return [];
  if (Array.isArray(tools)) {
    return tools
      .map((tool) => (tool && typeof tool === "object" ? (tool as { name?: unknown }).name : undefined))
      .filter((name): name is string => typeof name === "string");
  }
  if (typeof tools === "object") return Object.keys(tools);
  return [];
}

function messagesText(messages: unknown): string {
  return (messages as Array<{ content?: unknown }>)
    .map((message) => {
      if (typeof message.content === "string") return message.content;
      if (Array.isArray(message.content)) {
        return message.content
          .map((part) =>
            part && typeof part === "object" && "text" in part
              ? String((part as { text: unknown }).text)
              : JSON.stringify(part),
          )
          .join("\n");
      }
      return JSON.stringify(message.content);
    })
    .join("\n");
}

describe("get_widget_data identifier resolution", () => {
  it("matches by uuid (canonical case)", async () => {
    const events = await collectGenerator(
      runAgentLoop({
        request: { messages: [{ role: "human", content: "go" }] } as QueryRequest,
        rawModelId: "openai:gpt-4o-mini",
        model: makeMockLlm(
          llmCallsTool("get_widget_data", { widgets: [{ widget_uuid: "u-canonical" }] }),
        ),
        allWidgets: [widget()],
        workspaceState: null,
        conversationId: "wr-uuid",
      }),
    );
    const wd = findGetWidgetData(events);
    expect(wd).toBeDefined();
    const payload = wd!.data as { input_arguments: { data_sources: Array<{ widget_uuid: string }> } };
    expect(payload.input_arguments.data_sources[0].widget_uuid).toBe("u-canonical");
  });

  it("batches plain widgets into a single get_widget_data call", async () => {
    const first = widget({ uuid: "w-1", name: "Indexed ESG Trend Comparison" });
    const second = widget({ uuid: "w-2", name: "Executive ESG KPI Snapshot" });
    const events = await collectGenerator(
      runAgentLoop({
        request: { messages: [{ role: "human", content: "go" }] } as QueryRequest,
        rawModelId: "openai:gpt-4o-mini",
        model: makeMockLlm(
          llmCallsTool("get_widget_data", {
            widgets: [{ widget_uuid: "w-1" }, { widget_uuid: "w-2" }],
          }),
        ),
        allWidgets: [first, second],
        workspaceState: null,
        conversationId: "wr-batch-regular",
      }),
    );

    // Plain widgets load in one round-trip — the bridge fetches every
    // data_source in a single call — with a per-widget status line each.
    const statusMessages = events
      .filter((e) => e.event === "copilotStatusUpdate")
      .map((e) => (e.data as { message?: string }).message);
    expect(statusMessages).toContain('Loading "Indexed ESG Trend Comparison"');
    expect(statusMessages).toContain('Loading "Executive ESG KPI Snapshot"');
    const wd = findGetWidgetData(events);
    expect(wd).toBeDefined();
    const payload = wd!.data as {
      input_arguments: { data_sources: Array<{ widget_uuid: string }> };
    };
    expect(payload.input_arguments.data_sources.map((d) => d.widget_uuid)).toEqual(["w-1", "w-2"]);
  });

  it("injects all widget results from a single batched round-trip", async () => {
    // Outbound batching emits N data_sources in one call; confirm the reboot
    // maps all N results back to their widgets and loads each.
    const first = widget({ uuid: "w-1", name: "Indexed ESG Trend Comparison" });
    const second = widget({ uuid: "w-2", name: "Executive ESG KPI Snapshot" });
    const tool: ToolMessage = {
      role: "tool",
      function: "get_widget_data",
      input_arguments: { data_sources: [{ widget_uuid: "w-1" }, { widget_uuid: "w-2" }] },
      data: [
        { items: [{ content: JSON.stringify([{ Year: 2024, Value: 100 }]) }] },
        { items: [{ content: JSON.stringify([{ Kpi: "scope1", Score: 9 }]) }] },
      ] as unknown as ToolMessage["data"],
    };
    const events = await collectGenerator(
      runAgentLoop({
        request: { messages: [{ role: "human", content: "go" }, tool] } as QueryRequest,
        rawModelId: "openai:gpt-4o-mini",
        model: makeMockLlm(llmEmitsText("Both loaded.")),
        allWidgets: [first, second],
        workspaceState: null,
        conversationId: "wr-batch-reboot",
      }),
    );

    const statusMessages = events
      .filter((e) => e.event === "copilotStatusUpdate")
      .map((e) => (e.data as { message?: string }).message);
    expect(statusMessages).toContain('Loaded "Indexed ESG Trend Comparison" data.');
    expect(statusMessages).toContain('Loaded "Executive ESG KPI Snapshot" data.');
  });

  it("injects a compact loaded-table inventory into model context", async () => {
    await rememberRows("wr-loaded-inventory", "table_widget_with_string_filter", [
      { Year: 2020, date: "2020-01-01", Total_Emissions_tCO2e_Index: 100 },
      { Year: 2024, date: "2024-01-01", Total_Emissions_tCO2e_Index: 84 },
    ], { widgetUuid: "w-filter" });
    const spy = makeSpyMockLlm(llmEmitsText("Done."));

    await collectGenerator(
      runAgentLoop({
        request: { messages: [{ role: "human", content: "summarize loaded data" }] } as QueryRequest,
        rawModelId: "openai:gpt-4o-mini",
        model: spy.model,
        allWidgets: [widget({ uuid: "w-filter", name: "Table Widget with String Filter" })],
        workspaceState: null,
        conversationId: "wr-loaded-inventory",
      }),
    );

    const prompt = (spy.calls[0].messages as Array<{ content?: unknown }>)
      .map((message) => {
        if (typeof message.content === "string") return message.content;
        if (Array.isArray(message.content)) {
          return message.content
            .map((part) =>
              part && typeof part === "object" && "text" in part
                ? String((part as { text: unknown }).text)
                : JSON.stringify(part),
            )
            .join("\n");
        }
        return JSON.stringify(message.content);
      })
      .join("\n");
    expect(prompt).toContain("Already Loaded Queryable Tables");
    expect(prompt).toContain(
      '"table_widget_with_string_filter" (display name: "Table Widget with String Filter"; 2 loaded rows; loaded-row coverage: "date" 2020-01-01 to 2024-01-01)',
    );
    expect(prompt).toContain('"year" (INTEGER)');
    expect(prompt).toContain("Use display names, not queryable table names, in final answers");
    expect(prompt).toContain("never invent columns or assume dates outside the loaded range");
    expect(prompt).toContain("instead of calling `get_widget_data` again");
  });

  it("does not expose get_widget_data on the retry after all requested widgets resolved from cache", async () => {
    const table = widget({
      uuid: "w-filter",
      name: "Table Widget with String Filter",
      params: [
        { name: "filter_text", type: "text", description: "", current_value: "" },
      ],
    });
    const cachedTool: ToolMessage = {
      role: "tool",
      function: "get_widget_data",
      input_arguments: {
        data_sources: [
          {
            widget_uuid: "w-filter",
            input_args: { filter_text: "Char" },
          },
        ],
      },
      data: [
        {
          items: [
            {
              content: JSON.stringify([
                { name: "Charlie", value: 150, category: "C" },
              ]),
            },
          ],
        },
      ] as unknown as ToolMessage["data"],
    };
    await cacheWidgetItemsFromReboot(cachedTool, [table], "wr-cached-filter-retry");
    const spy = makeSequencedSpyMockLlm([
      llmCallsTool("get_widget_data", {
        widgets: [
          {
            widget_uuid: "w-filter",
            input_args: { filter_text: "Char" },
          },
        ],
      }),
      llmEmitsText("The filtered row is Charlie with value 150."),
    ]);

    const events = await collectGenerator(
      runAgentLoop({
        request: {
          messages: [{ role: "human", content: 'what values do u get when you filter by "Char"' }],
        } as QueryRequest,
        rawModelId: "openai:gpt-4o-mini",
        model: spy.model,
        allWidgets: [table],
        workspaceState: null,
        conversationId: "wr-cached-filter-retry",
      }),
    );

    expect(spy.calls).toHaveLength(2);
    expect(capturedToolNames(spy.calls[0].tools)).toContain("get_widget_data");
    expect(capturedToolNames(spy.calls[1].tools)).not.toContain("get_widget_data");
    expect(events).toContainEqual({
      event: "copilotMessageChunk",
      data: { delta: "The filtered row is Charlie with value 150." },
    });
  });

  it("all-cached re-loop: iter-0 preamble is reasoning, not part of the answer; artifact ordering holds", async () => {
    // The all-cached path re-loops internally (one POST, one FE bubble). Prose written in a step that calls
    // a tool (iter-0) is reasoning and is shown as a status; the answer is the step that calls no more tools.
    const table = widget({ uuid: "w-cache", name: "Prices Table", params: [] });
    const cachedTool: ToolMessage = {
      role: "tool",
      function: "get_widget_data",
      input_arguments: { data_sources: [{ widget_uuid: "w-cache" }] },
      data: [
        {
          items: [
            {
              content: JSON.stringify([
                { symbol: "NVDA", close: 100 },
                { symbol: "AAPL", close: 200 },
              ]),
            },
          ],
        },
      ] as unknown as ToolMessage["data"],
    };
    await cacheWidgetItemsFromReboot(cachedTool, [table], "wr-allcached-reloop");

    const events = await collectGenerator(
      runAgentLoop({
        request: {
          messages: [{ role: "human", content: "summarize prices" }],
        } as QueryRequest,
        rawModelId: "openai:gpt-4o-mini",
        model: makeSequencedMockLlm([
          // iter-0: preamble prose + a cached get_widget_data → internal re-loop,
          // NO SSE round-trip (the data is already cached).
          llmCallsToolWithText(
            "get_widget_data",
            { widgets: [{ widget_uuid: "w-cache" }] },
            "Let me pull the prices first.",
          ),
          // iter-1: a raw-data artifact, then the final answer with a paragraph
          // break (so the artifact weaves between the two paragraphs).
          llmCallsTool("create_artifact", {
            data: [
              { symbol: "NVDA", close: 100 },
              { symbol: "AAPL", close: 200 },
            ],
            artifact: { type: "table", name: "Prices", description: "loaded prices" },
          }),
          llmEmitsText("Here are the prices.\n\nTop close is 200."),
        ]),
        allWidgets: [table],
        workspaceState: null,
        promptSuggestionsEnabled: false,
        conversationId: "wr-allcached-reloop",
      }),
    );

    const text = events
      .filter((e) => e.event === "copilotMessageChunk")
      .map((e) => (e.data as { delta: string }).delta)
      .join("");
    // iter-0 preamble is reasoning: it is not in the answer.
    expect(text).not.toContain("Let me pull the prices first.");
    expect(text).toBe("Here are the prices.\n\nTop close is 200.");
    expect(
      events.some(
        (e) => e.event === "copilotStatusUpdate" && (e.data as { message?: string }).message === "Let me pull the prices first.",
      ),
    ).toBe(true);

    // Ordering: iter-0 reasoning → artifact → the answer.
    const preambleIdx = events.findIndex(
      (e) => e.event === "copilotStatusUpdate" && (e.data as { message?: string }).message === "Let me pull the prices first.",
    );
    const artifactIdx = events.findIndex((e) => e.event === "copilotMessageArtifact");
    const tailIdx = events.findIndex(
      (e) =>
        e.event === "copilotMessageChunk" &&
        (e.data as { delta: string }).delta.includes("Top close is 200"),
    );
    expect(preambleIdx).toBeGreaterThanOrEqual(0);
    expect(artifactIdx).toBeGreaterThan(preambleIdx);
    expect(tailIdx).toBeGreaterThan(artifactIdx);
  });

  it("does not reuse an argless cache entry for undeclared widget input_args", async () => {
    const table = widget({
      uuid: "w-filter",
      name: "Table Widget with String Filter",
      params: [],
    });
    const unfilteredTool: ToolMessage = {
      role: "tool",
      function: "get_widget_data",
      input_arguments: {
        data_sources: [{ widget_uuid: "w-filter" }],
      },
      data: [
        {
          items: [
            {
              content: JSON.stringify([
                { name: "Alpha", value: 100, category: "A" },
                { name: "Beta", value: 200, category: "B" },
                { name: "Charlie", value: 150, category: "C" },
                { name: "Delta", value: 300, category: "A" },
              ]),
            },
          ],
        },
      ] as unknown as ToolMessage["data"],
    };
    await cacheWidgetItemsFromReboot(unfilteredTool, [table], "wr-argless-cache-filter");

    const events = await collectGenerator(
      runAgentLoop({
        request: {
          messages: [{ role: "human", content: 'what values do u get when you filter by "Char"' }],
        } as QueryRequest,
        rawModelId: "openai:gpt-4o-mini",
        model: makeMockLlm(
          llmCallsTool("get_widget_data", {
            widgets: [
              {
                widget_uuid: "w-filter",
                input_args: { filter_text: "Char" },
              },
            ],
          }),
        ),
        allWidgets: [table],
        workspaceState: null,
        conversationId: "wr-argless-cache-filter",
      }),
    );

    const wd = findGetWidgetData(events);
    expect(wd).toBeDefined();
    const payload = wd!.data as {
      input_arguments: { data_sources: Array<{ input_args?: Record<string, unknown> }> };
    };
    expect(payload.input_arguments.data_sources[0].input_args).toEqual({ filter_text: "Char" });
  });

  it("invalidates stale cached rows when a filtered widget fetch returns no rows", async () => {
    const table = widget({
      uuid: "w-filter",
      name: "Table Widget with String Filter",
      params: [
        { name: "filter_text", type: "text", description: "", current_value: "Char" },
      ],
    });
    await rememberRows(
      "wr-empty-filter-invalidates",
      "table_widget_with_string_filter",
      [
        { name: "Alpha", value: 100, category: "A" },
        { name: "Beta", value: 200, category: "B" },
        { name: "Charlie", value: 150, category: "C" },
        { name: "Delta", value: 300, category: "A" },
      ],
      { widgetUuid: "w-filter", inputArgs: { filter_text: "Char" } },
    );
    const emptyFilteredTool: ToolMessage = {
      role: "tool",
      function: "get_widget_data",
      input_arguments: {
        data_sources: [
          {
            widget_uuid: "w-filter",
            input_args: { filter_text: "Char" },
          },
        ],
      },
      data: [{ items: [] }] as unknown as ToolMessage["data"],
    };
    const spy = makeSpyMockLlm(llmEmitsText("No rows matched the filter."));

    const events = await collectGenerator(
      runAgentLoop({
        request: {
          messages: [
            { role: "human", content: 'what values do u get when you filter by "Char"' },
            emptyFilteredTool,
          ],
        } as QueryRequest,
        rawModelId: "openai:gpt-4o-mini",
        model: spy.model,
        allWidgets: [table],
        workspaceState: null,
        conversationId: "wr-empty-filter-invalidates",
      }),
    );

    expect(spy.calls).toHaveLength(0);
    expect((await getCachedRows("wr-empty-filter-invalidates", [table])).size).toBe(0);
    const statusMessages = events
      .filter((e) => e.event === "copilotStatusUpdate")
      .map((e) => (e.data as { message?: string }).message);
    expect(statusMessages).toContain("get_widget_data: no usable data returned");
    const answerText = events
      .filter((e) => e.event === "copilotMessageChunk")
      .map((e) => (e.data as { delta?: string }).delta ?? "")
      .join("");
    expect(answerText).toContain("No values were returned");
  });

  it("does not seed cached widget rows when current widget params differ", async () => {
    const table = widget({
      uuid: "w-filter",
      name: "Table Widget with String Filter",
      params: [
        { name: "filter_text", type: "text", description: "", current_value: "Char" },
      ],
    });
    await rememberRows(
      "wr-param-cache-mismatch",
      "table_widget_with_string_filter",
      [
        { name: "Alpha", value: 100, category: "A" },
        { name: "Beta", value: 200, category: "B" },
        { name: "Charlie", value: 150, category: "C" },
        { name: "Delta", value: 300, category: "A" },
      ],
      { widgetUuid: "w-filter", inputArgs: { filter_text: "" } },
    );
    const spy = makeSpyMockLlm(llmEmitsText("Need fresh filtered data."));

    await collectGenerator(
      runAgentLoop({
        request: {
          messages: [{ role: "human", content: 'what values do u get when you filter by "Char"' }],
        } as QueryRequest,
        rawModelId: "openai:gpt-4o-mini",
        model: spy.model,
        allWidgets: [table],
        workspaceState: null,
        conversationId: "wr-param-cache-mismatch",
      }),
    );

    const prompt = messagesText(spy.calls[0].messages);
    expect(prompt).not.toContain('"table_widget_with_string_filter" (4 loaded rows');
  });

  it("does not fall back to widget_id when the model passed widget_id where uuid was expected", async () => {
    const events = await collectGenerator(
      runAgentLoop({
        request: { messages: [{ role: "human", content: "go" }] } as QueryRequest,
        rawModelId: "openai:gpt-4o-mini",
        model: makeMockLlm(
          llmCallsTool("get_widget_data", { widgets: [{ widget_uuid: "wid-fallback" }] }),
        ),
        allWidgets: [widget()],
        workspaceState: null,
        conversationId: "wr-fallback",
      }),
    );
    const wd = findGetWidgetData(events);
    expect(wd).toBeUndefined();
  });

  it("fetches a connected catalog widget that has no uuid (model sends widget_id)", async () => {
    // Connected widgets that are NOT on a dashboard arrive as catalog entries
    // with only a widget_id slug and no instance uuid. search_widgets surfaces
    // no uuid, so the model copies the widget_id into widget_uuid — the only
    // identifier it ever sees. Build allWidgets through getTieredWidgets, the
    // same ingest path query.ts uses, so the resolution is faithful to prod.
    const catalog = widget({
      uuid: undefined,
      widget_id: "financial_statements",
      name: "Financial Statements",
    });
    const request = {
      messages: [{ role: "human", content: "show the financial statements" }],
      widgets: { extra: [catalog] },
    } as QueryRequest;
    const allWidgets = getTieredWidgets(request).map((t) => t.widget);

    const events = await collectGenerator(
      runAgentLoop({
        request,
        rawModelId: "openai:gpt-4o-mini",
        model: makeMockLlm(
          llmCallsTool("get_widget_data", {
            widgets: [{ widget_uuid: "financial_statements" }],
          }),
        ),
        allWidgets,
        workspaceState: null,
        conversationId: "wr-no-uuid",
      }),
    );

    const wd = findGetWidgetData(events);
    expect(wd).toBeDefined();
    const payload = wd!.data as {
      input_arguments: { data_sources: Array<{ widget_uuid: string; id: string }> };
    };
    expect(payload.input_arguments.data_sources[0].widget_uuid).toBe("financial_statements");
    expect(payload.input_arguments.data_sources[0].id).toBe("financial_statements");
  });

  it("regression: emits no get_widget_data SSE when the identifier matches nothing", async () => {
    const events = await collectGenerator(
      runAgentLoop({
        request: { messages: [{ role: "human", content: "go" }] } as QueryRequest,
        rawModelId: "openai:gpt-4o-mini",
        model: makeMockLlm(
          llmCallsTool("get_widget_data", { widgets: [{ widget_uuid: "totally-bogus" }] }),
        ),
        allWidgets: [widget()],
        workspaceState: null,
        conversationId: "wr-bogus",
      }),
    );
    expect(findGetWidgetData(events)).toBeUndefined();
  });

  it("regression: identifier match is exact, not substring (uuid prefix collision)", async () => {
    // Two widgets — the model picks "u-1" but only "u-12" is in scope. We
    // shouldn't silently match the longer uuid.
    const w1 = widget({ uuid: "u-12", widget_id: "wid-12", name: "Twelve" });
    const events = await collectGenerator(
      runAgentLoop({
        request: { messages: [{ role: "human", content: "go" }] } as QueryRequest,
        rawModelId: "openai:gpt-4o-mini",
        model: makeMockLlm(
          llmCallsTool("get_widget_data", { widgets: [{ widget_uuid: "u-1" }] }),
        ),
        allWidgets: [w1],
        workspaceState: null,
        conversationId: "wr-prefix",
      }),
    );
    expect(findGetWidgetData(events)).toBeUndefined();
  });

  it("reconciles a dashboard widget_uuid to its unique same-named request widget", async () => {
    const fileWidget = widget({
      uuid: "file-03971611",
      widget_id: "file-03971611",
      name: "Microsoft SSO Setup Guide",
      metadata: { extension: "pdf" },
    });
    const events = await collectGenerator(
      runAgentLoop({
        request: {
          messages: [{ role: "human", content: "does it say single-page application?" }],
        } as QueryRequest,
        rawModelId: "openai:gpt-4o-mini",
        model: makeMockLlm(
          llmCallsTool("get_widget_data", { widgets: [{ widget_uuid: "5c3bb6bc" }] }),
        ),
        allWidgets: [fileWidget],
        workspaceState: {
          current_page_context: "dashboard",
          current_dashboard_info: {
            id: "dash-1",
            current_tab_id: "tab-1",
            tabs: [
              {
                tab_id: "tab-1",
                widgets: [{ widget_uuid: "5c3bb6bc", name: "Microsoft SSO Setup Guide" }],
              },
            ],
          },
        },
        conversationId: "wr-dashboard-reconcile",
      }),
    );
    // The dashboard cell uuid (5c3bb6bc) differs from the request widget id
    // (file-03971611) — they share only the name. The prompt feeds the model
    // that dashboard uuid, so a unique-name match must reconcile it to the
    // fetchable request widget.
    const wd = findGetWidgetData(events);
    expect(wd).toBeDefined();
    const payload = wd!.data as {
      input_arguments: { data_sources: Array<{ id: string }> };
    };
    expect(payload.input_arguments.data_sources[0].id).toBe("file-03971611");
  });

  it("regression: does not reconcile when the dashboard name is ambiguous across widgets", async () => {
    const a = widget({ uuid: "file-aaa", widget_id: "file-aaa", name: "Report" });
    const b = widget({ uuid: "file-bbb", widget_id: "file-bbb", name: "Report" });
    const events = await collectGenerator(
      runAgentLoop({
        request: { messages: [{ role: "human", content: "go" }] } as QueryRequest,
        rawModelId: "openai:gpt-4o-mini",
        model: makeMockLlm(
          llmCallsTool("get_widget_data", { widgets: [{ widget_uuid: "dash-report" }] }),
        ),
        allWidgets: [a, b],
        workspaceState: {
          current_page_context: "dashboard",
          current_dashboard_info: {
            id: "dash-1",
            current_tab_id: "tab-1",
            tabs: [{ tab_id: "tab-1", widgets: [{ widget_uuid: "dash-report", name: "Report" }] }],
          },
        },
        conversationId: "wr-dashboard-ambiguous",
      }),
    );
    // Two widgets named "Report" — reconciliation must decline, not guess.
    expect(findGetWidgetData(events)).toBeUndefined();
  });

  it("fetches a connected widget with parameter overrides without a schema gate", async () => {
    const fred = widget({
      uuid: "economy_fred_series_fred_obb",
      origin: "Open Data Platform",
      widget_id: "economy_fred_series_fred_obb",
      name: "Fred Series",
      params: [
        { name: "symbol", type: "text", description: "" },
        { name: "frequency", type: "text", description: "" },
        { name: "transform", type: "text", description: "" },
      ],
    });

    const events = await collectGenerator(
      runAgentLoop({
        request: { messages: [{ role: "human", content: "load UNRATE" }] } as QueryRequest,
        rawModelId: "openai:gpt-4o-mini",
        model: makeMockLlm(
          llmCallsTool("get_widget_data", {
            widgets: [
              {
                widget_uuid: "economy_fred_series_fred_obb",
                input_args: { symbol: "UNRATE", frequency: "monthly" },
              },
            ],
          }),
        ),
        allWidgets: [fred],
        tieredWidgets: [{ widget: fred, tier: "extra" }],
        workspaceState: null,
        promptSuggestionsEnabled: false,
        conversationId: "wr-data-schema-required",
      }),
    );

    const wd = findGetWidgetData(events);
    expect(wd).toBeDefined();
    expect((wd!.data as { input_arguments: { data_sources: unknown[] } }).input_arguments.data_sources)
      .toHaveLength(1);
  });

  it("rejects widget-data uuid/params aliases instead of normalizing them", async () => {
    const fred = widget({
      uuid: "economy_fred_series_fred_obb",
      origin: "Open Data Platform",
      widget_id: "economy_fred_series_fred_obb",
      name: "Fred Series",
      params: [
        { name: "symbol", type: "text", description: "" },
        { name: "frequency", type: "text", description: "" },
      ],
    });

    const events = await collectGenerator(
      runAgentLoop({
        request: { messages: [{ role: "human", content: "load UNRATE" }] } as QueryRequest,
        rawModelId: "openai:gpt-4o-mini",
        model: makeMockLlm(
          llmCallsTool("get_widget_data", {
            widgets: [
              {
                uuid: "economy_fred_series_fred_obb",
                params: { symbol: "UNRATE", frequency: "monthly" },
              },
            ],
          }),
        ),
        allWidgets: [fred],
        tieredWidgets: [{ widget: fred, tier: "extra" }],
        workspaceState: null,
        promptSuggestionsEnabled: false,
        conversationId: "wr-data-schema-required-aliases",
      }),
    );

    expect(findGetWidgetData(events)).toBeUndefined();
    expect(events.some((e) =>
      e.event === "copilotStatusUpdate" &&
      (e.data as { message?: string }).message === "Input rejected"
    )).toBe(true);
  });

  it("passes fixed provider overrides through unchanged", async () => {
    const unemployment = widget({
      uuid: "economy_unemployment_oecd_obb",
      origin: "Open Data Platform",
      widget_id: "economy_unemployment_oecd_obb",
      name: "Unemployment",
      params: [
        { name: "country", type: "text", description: "", default_value: "united_states" },
        { name: "frequency", type: "text", description: "", default_value: "monthly" },
        { name: "provider", type: "text", description: "", default_value: "oecd" },
      ],
    });

    const events = await collectGenerator(
      runAgentLoop({
        request: { messages: [{ role: "human", content: "load unemployment" }] } as QueryRequest,
        rawModelId: "openai:gpt-4o-mini",
        model: makeMockLlm(
          llmCallsTool("get_widget_data", {
            widgets: [
              {
                widget_uuid: "economy_unemployment_oecd_obb",
                input_args: {
                  country: "united_states",
                  frequency: "monthly",
                  provider: "fred",
                },
              },
            ],
          }),
        ),
        allWidgets: [unemployment],
        tieredWidgets: [{ widget: unemployment, tier: "secondary" }],
        workspaceState: null,
        promptSuggestionsEnabled: false,
        conversationId: "wr-provider-normalized",
      }),
    );

    const wd = findGetWidgetData(events);
    expect(wd).toBeDefined();
    const payload = wd!.data as {
      input_arguments: {
        data_sources: Array<{ input_args?: Record<string, unknown> }>;
      };
    };
    expect(payload.input_arguments.data_sources[0].input_args).toMatchObject({
      country: "united_states",
      frequency: "monthly",
      provider: "fred",
    });
  });
});

describe("the widget data cache keeps one chat's data for that chat", () => {
  const sharedWidget: Widget = {
    uuid: "stock_price",
    origin: "example",
    widget_id: "stock_price",
    name: "Stock Price",
    description: "Price",
    params: [],
  };
  const tableMessage = (value: number): ToolMessage =>
    ({
      role: "tool",
      function: "get_widget_data",
      input_arguments: { data_sources: [{ widget_uuid: "stock_price" }] },
      data: [{ items: [{ content: JSON.stringify([{ symbol: "AAPL", price: value }]), data_format: { data_type: "object", parse_as: "table" } }] }],
    }) as unknown as ToolMessage;

  async function fetchedBy(conversationId: string): Promise<unknown> {
    const spy = makeSequencedSpyMockLlm([llmCallsTool("get_widget_data", { widgets: [{ widget_uuid: "stock_price" }] }), llmEmitsText("done")]);
    const events = await collectGenerator(
      runAgentLoop({
        request: {
          messages: [{ role: "human", content: "price of AAPL?" }],
          widgets: { primary: [], secondary: [sharedWidget], extra: [] },
        } as unknown as QueryRequest,
        rawModelId: "p:m",
        model: spy.model,
        allWidgets: [sharedWidget],
        workspaceState: null,
        conversationId,
      }),
    );
    return events.find((e) => e.event === "copilotFunctionCall" && (e.data as { function?: string }).function === "get_widget_data");
  }

  it("does not hand one user's data to another who asks for the same widget", async () => {
    await cacheWidgetItemsFromReboot(tableMessage(111), [sharedWidget], "alice:chat-1");
    // Alice's own request is answered from her cache: no round trip to the browser.
    expect(await fetchedBy("alice:chat-1")).toBeUndefined();
    // Bob asks for the same widget and gets no data from Alice's cache: the agent goes to the browser for it.
    expect(await fetchedBy("bob:chat-9")).toBeDefined();
  });

  it("does not let one user fill in what another is then shown", async () => {
    // Mallory sends a made-up result for the widget Alice uses.
    await cacheWidgetItemsFromReboot(tableMessage(999999), [sharedWidget], "mallory:chat-1");
    expect(await fetchedBy("alice:chat-1")).toBeDefined();
  });

  it("caches nothing for a request that has no chat", async () => {
    await cacheWidgetItemsFromReboot(tableMessage(1), [sharedWidget], "");
    expect(await fetchedBy("")).toBeDefined();
  });
});
