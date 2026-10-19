import { describe, it, expect } from "bun:test";
import { buildMessages } from "../../../../src/agent/messages";
import type { QueryRequest } from "../../../../src/protocol/types";

function req(overrides: Partial<QueryRequest> = {}): QueryRequest {
  return { messages: [], ...overrides };
}

describe("buildMessages", () => {
  it("always emits system prompt as the first message", () => {
    const out = buildMessages(req());
    expect(out[0].role).toBe("system");
    expect(typeof out[0].content).toBe("string");
  });

  it("appends a user message containing each selected skill block", () => {
    const out = buildMessages(
      req({
        selected_skills: [
          { slug: "alpha", description: "d", contentMarkdown: "alpha body", source: "model_selected" },
          { slug: "beta", description: "d", contentMarkdown: "beta body", source: "forced_slash" },
        ],
      }),
    );
    expect(out[1].role).toBe("user");
    const c = out[1].content as string;
    expect(c).toContain('<skill name="alpha">');
    expect(c).toContain("alpha body");
    expect(c).toContain('<skill name="beta">');
    expect(c).toContain("beta body");
  });

  it("gives a picked skill of Ines's its instructions, which the Workspace does not send", () => {
    const out = buildMessages(
      req({
        selected_skills: [
          { slug: "html-chart", description: "charts", source: "forced_slash" },
          { slug: "not-a-skill", description: "unknown", source: "forced_slash" },
        ],
      }),
    );
    const c = out[1].content as string;
    expect(c).toContain('<skill name="html-chart">');
    expect(c).toContain("# Workspace chart colors skill");
    expect(c).not.toContain("not-a-skill");
  });

  it("does not append a skills user message when none are selected", () => {
    const out = buildMessages(req({ selected_skills: [] }));
    expect(out.find((m) => m.role === "user" && (m.content as string).includes("<skill"))).toBeUndefined();
  });

  it("maps human → user, ai → assistant in order, within the current turn", () => {
    const out = buildMessages(
      req({
        messages: [
          { role: "human", content: "hi" },
          { role: "ai", content: "hello" },
        ],
      }),
    );
    expect(out.slice(1)).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
  });

  it("serves only the current turn: what came before is a note, and the question", () => {
    const out = buildMessages(
      req({
        messages: [
          { role: "human", content: "hi" },
          { role: "ai", content: "hello" },
          { role: "human", content: "more" },
        ],
      }),
    );
    expect(out).toHaveLength(3);
    expect(out[1].role).toBe("user");
    expect(out[1].content as string).toContain("This conversation has 2 earlier messages");
    expect(out[1].content as string).toContain('#1 "hi"');
    expect(out[1].content as string).toContain("recall_conversation");
    expect(out[2]).toEqual({ role: "user", content: "more" });
    expect(JSON.stringify(out.slice(2))).not.toContain("hello");
  });

  it("says nothing of earlier messages when there are none", () => {
    const out = buildMessages(req({ messages: [{ role: "human", content: "first" }] }));
    expect(out.slice(1)).toEqual([{ role: "user", content: "first" }]);
  });

  it("does not grow with the length of the chat", () => {
    const chat = (pairs: number) =>
      buildMessages(
        req({
          messages: [
            ...Array.from({ length: pairs }).flatMap((_, i) => [
              { role: "human" as const, content: `question number ${i} ${"padding ".repeat(60)}` },
              { role: "ai" as const, content: `answer number ${i} ${"padding ".repeat(200)}` },
            ]),
            { role: "human" as const, content: "and now?" },
          ],
        }),
      );
    const size = (messages: ReturnType<typeof chat>) => messages.reduce((n, m) => n + String(m.content).length, 0);
    const short = size(chat(10));
    const long = size(chat(500));
    expect(long).toBeLessThan(short * 1.5);
  });

  it("cuts a message that is too long to be worth serving, and says so", () => {
    const out = buildMessages(req({ messages: [{ role: "human", content: "x".repeat(100_000) }] }));
    const served = out[1].content as string;
    expect(served.length).toBeLessThan(61_000);
    expect(served).toContain("more characters of this message are not shown");
  });

  it("does not feed raw copilot function-call envelopes back as assistant prose", () => {
    const out = buildMessages(
      req({
        messages: [
          {
            role: "ai",
            content: JSON.stringify({
              function: "get_widget_data",
              input_arguments: {
                data_sources: [{ widget_uuid: "w-1", id: "prices" }],
              },
            }),
          },
          { role: "human", content: "what happened?" },
        ],
      }),
    );
    expect(out.find((m) => m.role === "assistant")).toBeUndefined();
    expect(out.at(-1)).toEqual({ role: "user", content: "what happened?" });
  });

  it("does not feed raw copilot SSE envelopes back as assistant prose", () => {
    const out = buildMessages(
      req({
        messages: [
          {
            role: "ai",
            content: JSON.stringify({
              event: "copilotFunctionCall",
              data: {
                function: "get_widget_data",
                input_arguments: { data_sources: [] },
              },
            }),
          },
          { role: "ai", content: "normal answer" },
        ],
      }),
    );
    expect(out.filter((m) => m.role === "assistant")).toEqual([
      { role: "assistant", content: "normal answer" },
    ]);
  });

  it("preserves normal JSON assistant content that is not protocol", () => {
    const content = JSON.stringify({ summary: "ok", rows: 3 });
    const out = buildMessages(
      req({
        messages: [{ role: "ai", content }],
      }),
    );
    expect(out.at(-1)).toEqual({ role: "assistant", content });
  });

  it("strips artifact and citation placeholders from prior assistant prose", () => {
    const out = buildMessages(
      req({
        messages: [
          {
            role: "ai",
            content:
              "<|start_artifact_id|>artifact-1<|end_artifact_id|>" +
              "Here is the chart." +
              "<|start_citation_id|>citation-1<|end_citation_id|>",
          },
        ],
      }),
    );
    expect(out.at(-1)).toEqual({ role: "assistant", content: "Here is the chart." });
  });

  it("drops ai messages whose content is not a plain string", () => {
    const out = buildMessages(
      req({
        messages: [
          { role: "ai", content: { complex: "object" } as unknown as string },
          { role: "human", content: "hello" },
        ],
      }),
    );
    expect(out.find((m) => m.role === "assistant")).toBeUndefined();
    expect(out.at(-1)).toEqual({ role: "user", content: "hello" });
  });
});

describe("buildMessages — earlier tool results rendered into history", () => {
  type LooseMessages = QueryRequest["messages"];

  function mcpToolMsg(toolName: string, items: Array<{ text: string }>) {
    return {
      role: "tool",
      function: "execute_agent_tool",
      input_arguments: { tool_name: toolName, server_id: "ines" },
      data: [{ items }],
    };
  }

  it("renders earlier execute_agent_tool results (artifact ack + text), skipping the live last one", () => {
    const earlier = mcpToolMsg("mermaid_diagram", [
      {
        text: JSON.stringify({
          $ines_kind: "artifact",
          artifact: { type: "html", uuid: "u1", name: "Diagram", description: "", content: "<svg/>" },
        }),
      },
      { text: "Parse error on line 2" },
    ]);
    const last = mcpToolMsg("mermaid_diagram", [{ text: "LIVE RESULT MARKER" }]);
    const out = buildMessages(
      req({
        messages: [
          { role: "human", content: "draw it" },
          earlier,
          last,
        ] as unknown as LooseMessages,
      }),
    );
    const userContents = out
      .filter((m) => m.role === "user")
      .map((m) => m.content as string);
    const hist = userContents.find((c) => c.includes("Earlier tool result from mermaid_diagram"));
    expect(hist).toBeDefined();
    expect(hist).toContain('[Artifact "Diagram" (html) delivered to the user');
    expect(hist).toContain("Parse error on line 2");
    // The live (last) tool result is injected by the loop with full fidelity,
    // not by buildMessages — no double injection.
    expect(userContents.join("\n")).not.toContain("LIVE RESULT MARKER");
  });

  it("does not serve a tool result from a PRIOR turn (followed by a human message): the turn is over", () => {
    const priorTurnResult = mcpToolMsg("mermaid_diagram", [{ text: "prior turn outcome" }]);
    const out = buildMessages(
      req({
        messages: [
          { role: "human", content: "first ask" },
          priorTurnResult,
          { role: "human", content: "follow-up" },
        ] as unknown as LooseMessages,
      }),
    );
    expect(JSON.stringify(out)).not.toContain("prior turn outcome");
    expect(out.at(-1)).toEqual({ role: "user", content: "follow-up" });
  });
});

describe("buildMessages — earlier workspace bridge results rendered into history", () => {
  type LooseMessages = QueryRequest["messages"];

  function bridgeResult(fn: string, input: Record<string, unknown>, status: string, message: string) {
    return {
      role: "tool",
      function: fn,
      input_arguments: input,
      data: [{ status, message }],
    };
  }

  it("renders earlier update_widget results so the model remembers prior mutations, skipping the live last one", () => {
    const first = bridgeResult(
      "update_widget_in_dashboard",
      { widget_uuid: "w-1", config: { data_args: { sector: "technology" } } },
      "success",
      "Widget updated.",
    );
    const last = bridgeResult(
      "update_widget_in_dashboard",
      { widget_uuid: "w-2", config: { data_args: { sector: "technology" } } },
      "success",
      "Widget updated.",
    );
    const out = buildMessages(
      req({
        messages: [
          { role: "human", content: "update parameter sector to technology" },
          first,
          last,
        ] as unknown as LooseMessages,
      }),
    );
    const userContents = out
      .filter((m) => m.role === "user")
      .map((m) => m.content as string);
    const hist = userContents.find((c) => c.includes("Earlier workspace bridge result from update_widget_in_dashboard"));
    expect(hist).toBeDefined();
    expect(hist).toContain("w-1");
    expect(hist).toContain("success: Widget updated.");
    // The live (last) bridge result is injected by the loop via injectFromReboot,
    // not by buildMessages — w-2 must NOT be double-rendered here.
    expect(userContents.some((c) => c.includes("w-2"))).toBe(false);
  });

  it("ignores non-bridge tool functions in this branch", () => {
    const out = buildMessages(
      req({
        messages: [
          { role: "human", content: "hi" },
          bridgeResult("not_a_bridge_command", { x: 1 }, "success", "nope"),
          { role: "human", content: "again" },
        ] as unknown as LooseMessages,
      }),
    );
    const userContents = out
      .filter((m) => m.role === "user")
      .map((m) => m.content as string);
    expect(userContents.some((c) => c.includes("Earlier workspace bridge result"))).toBe(false);
  });
});
