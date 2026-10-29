import { describe, it, beforeEach } from "node:test";
import { expect } from "expect";
import {
  processMcpResult,
  type McpResultContext,
} from "../../../../src/mcp/results.ts";
import type { ToolMessage } from "../../../../src/protocol/types.ts";
import { clearAllModuleState } from "../../../helpers/clear-state.ts";

function freshCtx(conversationId = "conv-test"): McpResultContext {
  return {
    tables: [],
    artifactQueue: [],
    citations: [],
    messages: [],
    pendingTables: new Map(),
    conversationId,
  };
}

function toolMsg(items: Array<{ text?: string; content?: string }>, fn = "tool-1"): ToolMessage {
  return {
    role: "tool",
    function: "execute_agent_tool",
    input_arguments: { tool_name: fn, server_id: "ines-tools" },
    data: [{ items }],
  };
}

beforeEach(() => {
  clearAllModuleState();
});

describe("processMcpResult — plain text", () => {
  it("injects plain text as a user message", () => {
    const ctx = freshCtx();
    const summary = processMcpResult(toolMsg([{ text: "hello world" }]), ctx);
    expect(ctx.messages).toHaveLength(1);
    expect(ctx.messages[0].role).toBe("user");
    expect(ctx.messages[0].content).toContain("hello world");
    expect(summary.toolName).toBe("tool-1");
    expect(summary.serverId).toBe("ines-tools");
  });

  it("falls back to `content` field when `text` is absent", () => {
    const ctx = freshCtx();
    processMcpResult(toolMsg([{ content: "alt path" }]), ctx);
    expect(ctx.messages[0].content).toContain("alt path");
  });

  it("ignores empty/missing text items", () => {
    const ctx = freshCtx();
    processMcpResult(toolMsg([{ text: "" }, {}]), ctx);
    expect(ctx.messages).toHaveLength(0);
  });

  it("concatenates multiple text items with blank-line separator", () => {
    const ctx = freshCtx();
    processMcpResult(toolMsg([{ text: "first" }, { text: "second" }]), ctx);
    expect(ctx.messages[0].content).toContain("first\n\nsecond");
  });

  it("emits no message when data array is empty", () => {
    const ctx = freshCtx();
    processMcpResult({ ...toolMsg([]), data: [] }, ctx);
    expect(ctx.messages).toHaveLength(0);
  });
});

describe("processMcpResult — $ines_kind: artifact", () => {
  it("pushes a copilotMessageArtifact event onto the queue", () => {
    const ctx = freshCtx();
    const artifact = {
      type: "table",
      uuid: "u1",
      name: "T",
      description: "d",
      content: [{ a: 1 }],
    };
    processMcpResult(
      toolMsg([{ text: JSON.stringify({ $ines_kind: "artifact", artifact }) }]),
      ctx,
    );
    expect(ctx.artifactQueue).toHaveLength(1);
    expect(ctx.artifactQueue[0].event).toBe("copilotMessageArtifact");
  });

  it("injects an artifact-delivery ack into the LLM message so the model knows it succeeded", () => {
    const ctx = freshCtx();
    const artifact = {
      type: "html",
      uuid: "u9",
      name: "Top Chart",
      description: "d",
      content: "<img/>",
    };
    const summary = processMcpResult(
      toolMsg([{ text: JSON.stringify({ $ines_kind: "artifact", artifact }) }]),
      ctx,
    );
    expect(summary.artifactCount).toBe(1);
    expect(ctx.messages).toHaveLength(1);
    expect(ctx.messages[0].content).toContain('[Artifact "Top Chart" (html) delivered to the user');
  });
});

describe("processMcpResult — $ines_kind: artifact — empty content guard", () => {
  it("skips artifact with empty HTML content string", () => {
    const ctx = freshCtx();
    const artifact = { type: "html", uuid: "u1", name: "Empty", description: "d", content: "" };
    processMcpResult(
      toolMsg([{ text: JSON.stringify({ $ines_kind: "artifact", artifact }) }]),
      ctx,
    );
    expect(ctx.artifactQueue).toHaveLength(0);
  });

  it("skips artifact with empty table content array", () => {
    const ctx = freshCtx();
    const artifact = { type: "table", uuid: "u2", name: "Empty", description: "d", content: [] };
    processMcpResult(
      toolMsg([{ text: JSON.stringify({ $ines_kind: "artifact", artifact }) }]),
      ctx,
    );
    expect(ctx.artifactQueue).toHaveLength(0);
  });

  it("allows artifact with non-empty HTML content", () => {
    const ctx = freshCtx();
    const artifact = { type: "html", uuid: "u3", name: "Chart", description: "d", content: "<div>ok</div>" };
    processMcpResult(
      toolMsg([{ text: JSON.stringify({ $ines_kind: "artifact", artifact }) }]),
      ctx,
    );
    expect(ctx.artifactQueue).toHaveLength(1);
  });

  it("allows artifact with non-empty table content", () => {
    const ctx = freshCtx();
    const artifact = { type: "table", uuid: "u4", name: "T", description: "d", content: [{ a: 1 }] };
    processMcpResult(
      toolMsg([{ text: JSON.stringify({ $ines_kind: "artifact", artifact }) }]),
      ctx,
    );
    expect(ctx.artifactQueue).toHaveLength(1);
  });
});

describe("processMcpResult — $ines_kind: citation", () => {
  it("web citation with explicit id", () => {
    const ctx = freshCtx();
    processMcpResult(
      toolMsg([
        {
          text: JSON.stringify({
            $ines_kind: "citation",
            citation: { type: "web", url: "https://x", title: "X", id: "fixed-1" },
          }),
        },
      ]),
      ctx,
    );
    expect(ctx.citations).toHaveLength(1);
    expect(ctx.citations[0]).toMatchObject({ id: "fixed-1", type: "web", url: "https://x", title: "X" });
  });

  it("web citation without id assigns a uuid", () => {
    const ctx = freshCtx();
    processMcpResult(
      toolMsg([
        {
          text: JSON.stringify({
            $ines_kind: "citation",
            citation: { type: "web", url: "https://x", title: "X" },
          }),
        },
      ]),
      ctx,
    );
    expect(ctx.citations[0].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("document citation includes page when present", () => {
    const ctx = freshCtx();
    processMcpResult(
      toolMsg([
        {
          text: JSON.stringify({
            $ines_kind: "citation",
            citation: { type: "document", uri: "doc://a", title: "A", page: 7, id: "d-1" },
          }),
        },
      ]),
      ctx,
    );
    const cit = ctx.citations[0];
    expect(cit.type).toBe("document");
    if (cit.type === "document") {
      expect(cit.uri).toBe("doc://a");
      expect(cit.page).toBe(7);
    }
  });

  it("document citation omits page when absent", () => {
    const ctx = freshCtx();
    processMcpResult(
      toolMsg([
        {
          text: JSON.stringify({
            $ines_kind: "citation",
            citation: { type: "document", uri: "doc://b", title: "B" },
          }),
        },
      ]),
      ctx,
    );
    const cit = ctx.citations[0];
    if (cit.type === "document") {
      expect("page" in cit).toBe(false);
    }
  });
});

describe("processMcpResult — $ines_kind: sqlite_table", () => {
  it("loads non-empty rows into tables + pendingTables and emits preview text", () => {
    const ctx = freshCtx();
    processMcpResult(
      toolMsg([
        {
          text: JSON.stringify({
            $ines_kind: "sqlite_table",
            name: "Prices",
            rows: [{ symbol: "NVDA", close: 100 }, { symbol: "AAPL", close: 200 }],
          }),
        },
      ]),
      ctx,
    );
    expect(ctx.tables).toHaveLength(1);
    expect(ctx.tables[0].rowCount).toBe(2);
    expect(ctx.pendingTables.has(ctx.tables[0].tableName)).toBe(true);
    expect(ctx.messages).toHaveLength(1);
    expect(ctx.messages[0].content).toContain("rows available as table");
    expect(ctx.messages[0].content).toContain("execute_sql");
  });

  it("ignores empty-row tables", () => {
    const ctx = freshCtx();
    processMcpResult(
      toolMsg([
        {
          text: JSON.stringify({
            $ines_kind: "sqlite_table",
            name: "Empty",
            rows: [],
          }),
        },
      ]),
      ctx,
    );
    expect(ctx.tables).toHaveLength(0);
    expect(ctx.pendingTables.size).toBe(0);
    expect(ctx.messages).toHaveLength(0);
  });

  it("overwrites an existing pendingTables entry with the new rows", () => {
    const ctx = freshCtx();
    processMcpResult(
      toolMsg([
        {
          text: JSON.stringify({
            $ines_kind: "sqlite_table",
            name: "Prices",
            rows: [{ symbol: "AAPL", close: 100 }],
          }),
        },
      ]),
      ctx,
    );
    const tableName = ctx.tables[0].tableName;
    processMcpResult(
      toolMsg([
        {
          text: JSON.stringify({
            $ines_kind: "sqlite_table",
            name: "Prices",
            rows: [{ symbol: "MSFT", close: 500 }],
          }),
        },
      ]),
      ctx,
    );
    expect(ctx.pendingTables.get(tableName)).toEqual([{ symbol: "MSFT", close: 500 }]);
  });
});

describe("processMcpResult — $ines_kind: error", () => {
  it("emits an error preview text", () => {
    const ctx = freshCtx();
    const summary = processMcpResult(
      toolMsg([
        {
          text: JSON.stringify({
            $ines_kind: "error",
            error: { code: "TIMEOUT", message: "took too long", retryable: true },
          }),
        },
      ]),
      ctx,
    );
    expect(summary.errorCount).toBe(1);
    expect(ctx.messages[0].content).toContain("[ERROR TIMEOUT retryable]");
    expect(ctx.messages[0].content).toContain("took too long");
  });

  it("non-retryable error omits the retryable tag", () => {
    const ctx = freshCtx();
    processMcpResult(
      toolMsg([
        {
          text: JSON.stringify({
            $ines_kind: "error",
            error: { code: "FATAL", message: "boom" },
          }),
        },
      ]),
      ctx,
    );
    expect(ctx.messages[0].content).toContain("[ERROR FATAL]");
    expect(ctx.messages[0].content).not.toContain("retryable");
  });

  it("does not append retry guidance for errors with details", () => {
    const ctx = freshCtx();
    processMcpResult(
      toolMsg([
        {
          text: JSON.stringify({
            $ines_kind: "error",
            error: { code: "BAD_INPUT", message: "missing field 'symbol'" },
          }),
        },
      ]),
      ctx,
    );
    expect(ctx.messages[0].content).toContain("missing field 'symbol'");
    expect(ctx.messages[0].content).not.toContain("Use this error to adjust");
    expect(ctx.messages[0].content).not.toContain("No diagnostic returned");
  });

  it("does not append retry guidance for errors without details", () => {
    const ctx = freshCtx();
    processMcpResult(
      toolMsg([
        {
          text: JSON.stringify({
            $ines_kind: "error",
            error: { code: "OPAQUE", message: "" },
          }),
        },
      ]),
      ctx,
    );
    expect(ctx.messages[0].content).toContain("[ERROR OPAQUE]");
    expect(ctx.messages[0].content).not.toContain("No diagnostic returned");
    expect(ctx.messages[0].content).not.toContain("Use this error to adjust");
  });
});

describe("processMcpResult — $ines_kind: model_context", () => {
  it("replaces all plain text in the LLM message", () => {
    const ctx = freshCtx();
    processMcpResult(
      toolMsg([
        { text: "ignored prose" },
        { text: JSON.stringify({ $ines_kind: "model_context", summary: "use this only" }) },
      ]),
      ctx,
    );
    expect(ctx.messages).toHaveLength(1);
    expect(ctx.messages[0].content).toContain("use this only");
    expect(ctx.messages[0].content).not.toContain("ignored prose");
  });

  it("last model_context wins when multiple are emitted", () => {
    const ctx = freshCtx();
    processMcpResult(
      toolMsg([
        { text: JSON.stringify({ $ines_kind: "model_context", summary: "first" }) },
        { text: JSON.stringify({ $ines_kind: "model_context", summary: "second" }) },
      ]),
      ctx,
    );
    expect(ctx.messages[0].content).toContain("second");
    expect(ctx.messages[0].content).not.toContain("first");
  });
});

describe("processMcpResult — payload normalization regressions (ada normalize_jsonish parity)", () => {

  type Case = { name: string; text: string; assert: (ctx: McpResultContext) => void };

  const cases: Case[] = [
    {
      name: "plain prose passes through to messages",
      text: "hello world",
      assert: (ctx) => {
        expect(ctx.messages.at(0)?.content).toContain("hello world");
        expect(ctx.citations).toHaveLength(0);
      },
    },
    {
      name: "empty string is skipped",
      text: "",
      assert: (ctx) => {
        expect(ctx.messages).toHaveLength(0);
      },
    },
    {
      name: "whitespace-only string passes through (workspace may inject it)",
      text: "   ",
      assert: (ctx) => {
        expect(ctx.messages.at(0)?.content).toContain("   ");
      },
    },
    {
      name: "malformed JSON object falls through to text",
      text: "{not valid json",
      assert: (ctx) => {
        expect(ctx.messages.at(0)?.content).toContain("{not valid json");
        expect(ctx.citations).toHaveLength(0);
      },
    },
    {
      name: "JSON with $ines_kind dispatches typed",
      text: JSON.stringify({ $ines_kind: "citation", citation: { type: "web", url: "https://r", title: "R", id: "r-1" } }),
      assert: (ctx) => {
        expect(ctx.citations).toHaveLength(1);
        expect(ctx.messages).toHaveLength(0);
      },
    },
    {
      name: "JSON without $ines_kind falls through to text (raw JSON)",
      text: JSON.stringify({ foo: "bar" }),
      assert: (ctx) => {
        expect(ctx.messages.at(0)?.content).toContain('"foo"');
        expect(ctx.citations).toHaveLength(0);
      },
    },
    {
      name: "double-stringified array recurses element-by-element",
      text: JSON.stringify([
        "first prose",
        JSON.stringify({ $ines_kind: "citation", citation: { type: "web", url: "https://d", title: "D" } }),
        "third prose",
      ]),
      assert: (ctx) => {
        expect(ctx.citations).toHaveLength(1);
        expect(ctx.messages.at(0)?.content).toContain("first prose");
        expect(ctx.messages.at(0)?.content).toContain("third prose");
      },
    },
    {
      name: "single-element array unwraps cleanly",
      text: JSON.stringify(["solo prose"]),
      assert: (ctx) => {
        expect(ctx.messages.at(0)?.content).toContain("solo prose");
      },
    },
    {
      name: "array of typed objects dispatches each",
      text: JSON.stringify([
        { $ines_kind: "citation", citation: { type: "web", url: "https://a", title: "A" } },
        { $ines_kind: "citation", citation: { type: "web", url: "https://b", title: "B" } },
      ]),
      assert: (ctx) => {
        expect(ctx.citations).toHaveLength(2);
      },
    },
  ];

  for (const c of cases) {
    it(`regression: ${c.name}`, () => {
      const ctx = freshCtx();
      processMcpResult(toolMsg([{ text: c.text }]), ctx);
      c.assert(ctx);
    });
  }

  it("regression: multi-item response processes each item independently (no stale state)", () => {
    const ctx = freshCtx();
    processMcpResult(
      toolMsg([
        {
          text: JSON.stringify({
            $ines_kind: "citation",
            citation: { type: "web", url: "https://1", title: "1" },
          }),
        },
        { text: "plain prose" },
        {
          text: JSON.stringify({
            $ines_kind: "citation",
            citation: { type: "web", url: "https://2", title: "2" },
          }),
        },
      ]),
      ctx,
    );
    expect(ctx.citations).toHaveLength(2);
    expect(ctx.messages.at(0)?.content).toContain("plain prose");
  });
});

describe("processMcpResult — flattened content[] (workspace JSON-stringifies the array)", () => {
  it("recurses into stringified array elements and dispatches typed items inside", () => {
    const ctx = freshCtx();
    const flattened = JSON.stringify([
      "plain prose",
      JSON.stringify({
        $ines_kind: "citation",
        citation: { type: "web", url: "https://flat", title: "Flat" },
      }),
    ]);
    processMcpResult(toolMsg([{ text: flattened }]), ctx);
    expect(ctx.citations).toHaveLength(1);
    expect(ctx.messages[0].content).toContain("plain prose");
  });

  it("non-string array element with $ines_kind dispatches directly", () => {
    const ctx = freshCtx();
    const flattened = JSON.stringify([
      { $ines_kind: "citation", citation: { type: "web", url: "https://obj", title: "Obj" } },
    ]);
    processMcpResult(toolMsg([{ text: flattened }]), ctx);
    expect(ctx.citations).toHaveLength(1);
  });
});

describe("processMcpResult — summary", () => {
  it("counts artifacts, citations, tables, errors", () => {
    const ctx = freshCtx();
    const summary = processMcpResult(
      toolMsg([
        {
          text: JSON.stringify({
            $ines_kind: "artifact",
            artifact: { type: "table", uuid: "a", name: "n", description: "d", content: [{ x: 1 }] },
          }),
        },
        {
          text: JSON.stringify({
            $ines_kind: "citation",
            citation: { type: "web", url: "https://x", title: "X" },
          }),
        },
        {
          text: JSON.stringify({
            $ines_kind: "sqlite_table",
            name: "T",
            rows: [{ a: 1 }],
          }),
        },
        {
          text: JSON.stringify({
            $ines_kind: "error",
            error: { code: "E", message: "m" },
          }),
        },
      ]),
      ctx,
    );
    expect(summary.artifactCount).toBe(1);
    expect(summary.citationCount).toBe(1);
    expect(summary.tableCount).toBe(1);
    expect(summary.errorCount).toBe(1);
    expect(summary.hasModelContext).toBe(false);
  });

  it("flags hasModelContext when summary is present", () => {
    const ctx = freshCtx();
    const summary = processMcpResult(
      toolMsg([
        { text: JSON.stringify({ $ines_kind: "model_context", summary: "ctx" }) },
      ]),
      ctx,
    );
    expect(summary.hasModelContext).toBe(true);
  });
});

describe("processMcpResult — what the model is given of a long result", () => {
  it("is the start of it, with how much was left out", () => {
    const ctx = freshCtx();
    const summary = processMcpResult(toolMsg([{ text: `START ${"x".repeat(500_000)} END` }], "big_tool"), ctx);
    const content = (ctx.messages[0] as { content: string }).content;
    expect(content.length).toBeLessThan(41_000);
    expect(content).toContain("START");
    expect(content).not.toContain("END");
    expect(content).toMatch(/more characters are not shown/);
    expect(summary.textChars).toBeGreaterThan(500_000);
  });

  it("is the whole of a result that fits", () => {
    const ctx = freshCtx();
    processMcpResult(toolMsg([{ text: "short result" }]), ctx);
    expect((ctx.messages[0] as { content: string }).content).toContain("short result");
    expect((ctx.messages[0] as { content: string }).content).not.toContain("not shown");
  });
});
