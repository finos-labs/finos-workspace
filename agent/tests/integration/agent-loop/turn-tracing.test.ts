import { describe, it, before as beforeAll, beforeEach, after as afterAll } from "node:test";
import { expect } from "expect";
import { trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { runAgentLoop } from "../../../src/agent/loop.ts";
import { parseTraceparent } from "../../../src/lib/telemetry.ts";
import type { TurnUsage } from "../../../src/lib/token-usage.ts";
import type { QueryRequest, SSEEvent, ToolMessage } from "../../../src/protocol/types.ts";
import {
  llmCallsTool,
  llmEmitsText,
  makeMockLlm,
  makeSpyMockLlm,
  type SpyMockLlm,
} from "../../helpers/mock-llm.ts";
import { collectGenerator } from "../../helpers/sse-reader.ts";
import { clearAllModuleState } from "../../helpers/clear-state.ts";

const exporter = new InMemorySpanExporter();
let provider: BasicTracerProvider | undefined;

beforeAll(() => {
  provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  trace.setGlobalTracerProvider(provider);
});

afterAll(async () => {
  await provider?.shutdown();
  trace.disable();
});

beforeEach(() => {
  clearAllModuleState();
  exporter.reset();
});

interface ExtraState {
  traceparent?: string;
  turn_usage?: TurnUsage;
  timezone?: string;
}

function bridgeExtraState(events: SSEEvent[]): ExtraState {
  const fc = events.find((e) => e.event === "copilotFunctionCall");
  expect(fc).toBeDefined();
  return (fc!.data as { extra_state?: ExtraState }).extra_state ?? {};
}

function firstRequest(conversationId: string) {
  return runAgentLoop({
    request: {
      messages: [{ role: "human", content: "make me tabs" }],
    } as unknown as QueryRequest,
    rawModelId: "openai:gpt-4o-mini",
    model: makeMockLlm(
      llmCallsTool("manage_navigation_bar", {
        operation: "create" as const,
        tabs: [{ name: "AAPL Analysis" }],
      }),
    ),
    allWidgets: [],
    workspaceState: null,
    conversationId,
  });
}

function rePost(conversationId: string, extraState: Record<string, unknown>) {
  const toolMsg: ToolMessage = {
    role: "tool",
    function: "manage_navigation_bar",
    input_arguments: {},
    extra_state: extraState,
    data: [
      { ok: true, command: "manage_navigation_bar", request_id: null, message: "Tabs created." },
    ] as unknown as ToolMessage["data"],
  };
  return runAgentLoop({
    request: {
      messages: [{ role: "human", content: "make me tabs" }, toolMsg],
    } as unknown as QueryRequest,
    rawModelId: "openai:gpt-4o-mini",
    model: makeMockLlm(llmEmitsText("Done — tabs created.")),
    allWidgets: [],
    workspaceState: null,
    conversationId,
  });
}

function rePostWithBridgeCall(conversationId: string, extraState: Record<string, unknown>) {
  const toolMsg: ToolMessage = {
    role: "tool",
    function: "manage_navigation_bar",
    input_arguments: {},
    extra_state: extraState,
    data: [
      { ok: true, command: "manage_navigation_bar", request_id: null, message: "Tabs created." },
    ] as unknown as ToolMessage["data"],
  };
  return runAgentLoop({
    request: {
      messages: [{ role: "human", content: "make me tabs" }, toolMsg],
    } as unknown as QueryRequest,
    rawModelId: "openai:gpt-4o-mini",
    model: makeMockLlm(
      llmCallsTool("manage_navigation_bar", {
        operation: "create" as const,
        tabs: [{ name: "Second Tab" }],
      }),
    ),
    allWidgets: [],
    workspaceState: null,
    conversationId,
  });
}

function turnSpans() {
  return exporter.getFinishedSpans().filter((s) => s.name === "agent.turn.request");
}

describe("turn tracing across re-POSTs", () => {
  it("emits one span per request, and the first request's span is a trace root", async () => {
    await collectGenerator(firstRequest("t-root"));
    const spans = turnSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].parentSpanContext).toBeUndefined();
  });

  it("echoes a traceparent pointing at the first request's own span", async () => {
    const events = await collectGenerator(firstRequest("t-echo"));
    const { traceparent } = bridgeExtraState(events);
    const span = turnSpans()[0];
    expect(traceparent).toBe(
      `00-${span.spanContext().traceId}-${span.spanContext().spanId}-01`,
    );
  });

  it("puts the re-POST in the SAME trace as the first request", async () => {
    const first = await collectGenerator(firstRequest("t-join"));
    const echoed = bridgeExtraState(first);
    exporter.reset();

    await collectGenerator(rePost("t-join", { traceparent: echoed.traceparent }));

    const second = turnSpans()[0];
    const firstCtx = echoed.traceparent!.split("-");
    expect(second.spanContext().traceId).toBe(firstCtx[1]);
    expect(second.parentSpanContext?.spanId).toBe(firstCtx[2]);
  });

  it("keeps every later request a direct CHILD of the first — not nested one level deeper each time", async () => {
    const first = await collectGenerator(firstRequest("t-flat"));
    const rootTraceparent = bridgeExtraState(first).traceparent!;

    const middle = await collectGenerator(
      rePostWithBridgeCall("t-flat", { traceparent: rootTraceparent }),
    );
    expect(bridgeExtraState(middle).traceparent).toBe(rootTraceparent);

    await collectGenerator(rePost("t-flat", { traceparent: rootTraceparent }));
    const spans = turnSpans();
    const rootSpanId = rootTraceparent.split("-")[2];
    for (const s of spans.slice(1)) {
      expect(s.parentSpanContext?.spanId).toBe(rootSpanId);
    }
  });

  it("records the turn's token total on the span, not just the request's", async () => {
    const first = await collectGenerator(firstRequest("t-usage-span"));
    const echoed = bridgeExtraState(first);
    exporter.reset();

    await collectGenerator(
      rePost("t-usage-span", {
        traceparent: echoed.traceparent,
        turn_usage: echoed.turn_usage,
      }),
    );

    const attrs = turnSpans()[0].attributes;
    expect(attrs["agent.usage.turn.post_count"]).toBe(2);
    expect(attrs["agent.usage.turn.total_tokens"]).toBe(4);
    expect(attrs["agent.conversation_id"]).toBe("t-usage-span");
  });

  it("tags the turn span with the standard session.id attribute", async () => {
    await collectGenerator(firstRequest("chat-abc"));
    expect(turnSpans()[0].attributes["session.id"]).toBe("chat-abc");
  });

  it("omits session.id entirely when there is no conversation id", async () => {
    await collectGenerator(firstRequest(""));
    expect(turnSpans()[0].attributes).not.toHaveProperty("session.id");
    expect(turnSpans()[0].attributes["agent.conversation_id"]).toBe("(missing)");
  });

  it("ends the span even when the request exits early through a round-trip return", async () => {
    await collectGenerator(firstRequest("t-early-exit"));
    expect(turnSpans()).toHaveLength(1);
    expect(turnSpans()[0].ended).toBe(true);
  });
});

describe("turn tracing — untrusted echoed state", () => {
  it("accumulates token usage across requests", async () => {
    const first = await collectGenerator(firstRequest("t-usage"));
    const afterFirst = bridgeExtraState(first).turn_usage;
    expect(afterFirst).toEqual({
      inputTokens: 1,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 1,
      totalTokens: 2,
      postCount: 1,
    });
  });

  for (const [label, bad] of [
    ["a malformed traceparent", "not-a-traceparent"],
    ["an all-zero trace id", "00-00000000000000000000000000000000-00f067aa0ba902b7-01"],
    ["a non-string", 42],
    ["a header-injection attempt", "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01\r\nX: 1"],
  ]) {
    it(`starts a fresh trace (and does not throw) given ${label}`, async () => {
      const events = await collectGenerator(
        rePost("t-bad", { traceparent: bad as unknown as string }),
      );
      expect(events.length).toBeGreaterThan(0);
      const span = turnSpans()[0];
      expect(span).toBeDefined();
      expect(span.parentSpanContext).toBeUndefined();
    });
  }

  it("does not propagate a traceparent it refused to parse", async () => {
    const events = await collectGenerator(
      rePostWithBridgeCall("t-poison", { traceparent: "garbage-not-a-traceparent" }),
    );
    const echoed = bridgeExtraState(events).traceparent;
    expect(echoed).not.toBe("garbage-not-a-traceparent");
    expect(parseTraceparent(echoed)).not.toBeNull();
    expect(echoed).toBe(
      `00-${turnSpans()[0].spanContext().traceId}-${turnSpans()[0].spanContext().spanId}-01`,
    );
  });

  it("resets a corrupted turn_usage to zero instead of failing the turn", async () => {
    const events = await collectGenerator(
      rePost("t-bad-usage", {
        turn_usage: { inputTokens: -5, outputTokens: "x", totalTokens: null, postCount: 3 },
      }),
    );
    expect(events.length).toBeGreaterThan(0);
    expect(turnSpans()[0].attributes["agent.usage.turn.post_count"]).toBe(1);
  });
});

describe("turn tracing — timezone carries across the round-trip", () => {
  const TZ = "America/New_York";

  function systemPromptOf(spy: SpyMockLlm): string {
    const msgs = spy.calls[0]?.messages as Array<{ role: string; content: unknown }>;
    expect(msgs?.[0]?.role).toBe("system");
    const content = msgs[0].content;
    return typeof content === "string" ? content : JSON.stringify(content);
  }

  function firstPost(spy: SpyMockLlm, timezone?: string) {
    return runAgentLoop({
      request: {
        messages: [{ role: "human", content: "make me tabs" }],
        ...(timezone ? { timezone } : {}),
      } as unknown as QueryRequest,
      rawModelId: "openai:gpt-4o-mini",
      model: spy.model,
      allWidgets: [],
      workspaceState: null,
      conversationId: "t-tz",
    });
  }

  function bridgeRePost(spy: SpyMockLlm, extraState: Record<string, unknown>) {
    const toolMsg: ToolMessage = {
      role: "tool",
      function: "manage_navigation_bar",
      input_arguments: {},
      extra_state: extraState,
      data: [
        { ok: true, command: "manage_navigation_bar", request_id: null, message: "Tabs created." },
      ] as unknown as ToolMessage["data"],
    };
    return runAgentLoop({
      request: {
        messages: [{ role: "human", content: "make me tabs" }, toolMsg],
      } as unknown as QueryRequest,
      rawModelId: "openai:gpt-4o-mini",
      model: spy.model,
      allWidgets: [],
      workspaceState: null,
      conversationId: "t-tz",
    });
  }

  it("echoes the timezone forward on every round-trip emission", async () => {
    const spy = makeSpyMockLlm(
      llmCallsTool("manage_navigation_bar", {
        operation: "create" as const,
        tabs: [{ name: "AAPL Analysis" }],
      }),
    );
    const events = await collectGenerator(firstPost(spy, TZ));
    expect(bridgeExtraState(events).timezone).toBe(TZ);
  });

  it("keeps the system prompt byte-identical across the round-trip", async () => {
    const firstSpy = makeSpyMockLlm(
      llmCallsTool("manage_navigation_bar", {
        operation: "create" as const,
        tabs: [{ name: "AAPL Analysis" }],
      }),
    );
    const first = await collectGenerator(firstPost(firstSpy, TZ));

    const secondSpy = makeSpyMockLlm(llmEmitsText("Done — tabs created."));
    await collectGenerator(
      bridgeRePost(secondSpy, bridgeExtraState(first) as Record<string, unknown>),
    );

    expect(systemPromptOf(secondSpy)).toBe(systemPromptOf(firstSpy));
  });

  it("renders the re-POST date in the user's zone, not UTC", async () => {
    const firstSpy = makeSpyMockLlm(
      llmCallsTool("manage_navigation_bar", {
        operation: "create" as const,
        tabs: [{ name: "AAPL Analysis" }],
      }),
    );
    const first = await collectGenerator(firstPost(firstSpy, TZ));

    const secondSpy = makeSpyMockLlm(llmEmitsText("Done."));
    await collectGenerator(
      bridgeRePost(secondSpy, bridgeExtraState(first) as Record<string, unknown>),
    );

    expect(systemPromptOf(secondSpy)).toContain(`User timezone: ${TZ}`);
    expect(systemPromptOf(secondSpy)).not.toContain("User timezone: UTC");
  });

  it("stays stable across the round-trip when no timezone is ever supplied", async () => {
    const firstSpy = makeSpyMockLlm(
      llmCallsTool("manage_navigation_bar", {
        operation: "create" as const,
        tabs: [{ name: "AAPL Analysis" }],
      }),
    );
    const first = await collectGenerator(firstPost(firstSpy));

    const secondSpy = makeSpyMockLlm(llmEmitsText("Done."));
    await collectGenerator(
      bridgeRePost(secondSpy, bridgeExtraState(first) as Record<string, unknown>),
    );

    expect(systemPromptOf(secondSpy)).toBe(systemPromptOf(firstSpy));
    expect(systemPromptOf(secondSpy)).toContain("User timezone: UTC");
  });

  it("falls back to UTC on a corrupted echoed timezone instead of failing the turn", async () => {
    const spy = makeSpyMockLlm(llmEmitsText("Done."));
    const events = await collectGenerator(bridgeRePost(spy, { timezone: "Not/AZone" }));
    expect(events.length).toBeGreaterThan(0);
    expect(systemPromptOf(spy)).toContain("User timezone: UTC");
  });
});
