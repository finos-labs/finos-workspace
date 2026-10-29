import { describe, it } from "node:test";
import { expect } from "expect";
import {
  readExtraState,
  makeExtraState,
} from "../../../../src/protocol/extra-state.ts";
import type { ToolMessage } from "../../../../src/protocol/types.ts";

function tm(extra?: Record<string, unknown>): ToolMessage {
  return {
    role: "tool",
    function: "execute_agent_tool",
    input_arguments: {},
    data: [],
    ...(extra ? { extra_state: extra } : {}),
  };
}

describe("readExtraState", () => {
  it("returns {} when extra_state is missing", () => {
    expect(readExtraState(tm())).toEqual({});
  });

  it("returns {} when extra_state is not an object", () => {
    expect(readExtraState({ ...tm(), extra_state: "string" as unknown as Record<string, unknown> })).toEqual({});
  });

  it("returns the raw object when shape is correct", () => {
    const e = { intermediate_context: "ctx", documents_shipped: ["d1"] };
    expect(readExtraState(tm(e))).toEqual(e);
  });
});

describe("readExtraState — what a client sends back", () => {
  it("drops a field of the wrong shape and keeps the others", () => {
    const out = readExtraState(
      tm({
        loaded_tool_groups: 5,
        loaded_skill_slugs: "x",
        timezone: { not: "a string" },
        documents_shipped: ["d1"],
        intermediate_context: "ctx",
      }),
    );
    expect(out).toEqual({ documents_shipped: ["d1"], intermediate_context: "ctx" });
    expect("loaded_tool_groups" in out).toBe(false);
  });

  it("drops the elements of a list that are of the wrong shape and keeps the others", () => {
    const out = readExtraState(tm({ loaded_tool_groups: ["sql", 7, null, { a: 1 }, "dashboard"], documents_shipped: [null, "d1"] }));
    expect(out.loaded_tool_groups).toEqual(["sql", "dashboard"]);
    expect(out.documents_shipped).toEqual(["d1"]);
  });

  it("limits a list, and a string", () => {
    const out = readExtraState(
      tm({ documents_shipped: Array.from({ length: 5000 }, (_, i) => `d${i}`), traceparent: "x".repeat(500), loaded_tool_groups: ["g".repeat(600), "ok"] }),
    );
    expect(out.documents_shipped).toHaveLength(500);
    expect(out.traceparent).toBeUndefined();
    expect(out.loaded_tool_groups).toEqual(["ok"]);
  });

  it("keeps the document hits the tool reported, and drops the ones that are not", () => {
    const good = { id: "d1", type: "document", uri: "ines-doc://c/d1", title: "plan.pdf", page: 2, score: 0.58 };
    const out = readExtraState(
      tm({
        document_hits: [good, null, { id: "d1", type: "document" }, { ...good, page: 0 }, { ...good, page: "2" }, { ...good, type: "web" }, { ...good, score: 7 }, "x"],
      }),
    );
    expect(out.document_hits as unknown).toEqual([good]);
  });

  it("keeps the citations that have what the loop reads from them, and drops the others", () => {
    const widget = { id: "c1", source_info: { type: "widget", name: "W", metadata: { input_args: {}, widget_uuid: "u" }, citable: true }, details: [{ Filename: "a.pdf", Page: 2 }], signature: "" };
    const web = { id: "c2", source_info: { type: "web", name: "X", citable: true }, details: [{ link: "https://x" }], signature: "" };
    const out = readExtraState(
      tm({
        intermediate_citations: [
          widget,
          web,
          { id: "c3", source_info: { type: "widget", name: "no metadata" }, details: [] },
          { id: "c4", source_info: { type: "mystery", name: "?" }, details: [] },
          { id: "c5", details: [] },
          "x",
          null,
        ],
      }),
    );
    expect(out.intermediate_citations as unknown).toEqual([widget, web]);
  });

  it("keeps the queued bridge calls that have a function and arguments", () => {
    const out = readExtraState(
      tm({ pending_bridge_calls: [{ function: "manage_navigation_bar", input_arguments: { operation: "create" } }, { function: 7 }, null, { function: "x" }] }),
    );
    expect(out.pending_bridge_calls).toEqual([{ function: "manage_navigation_bar", input_arguments: { operation: "create" } }]);
  });

  it("keeps the queued calls of the FINOS Workspace's tools that have a name and arguments", () => {
    const out = readExtraState(
      tm({
        pending_workspace_calls: [
          { tool_name: "Workspace_update_widget", input_arguments: { widget_uuid: "w-1" } },
          { tool_name: 7, input_arguments: {} },
          { tool_name: "Workspace_update_widget" },
          null,
        ],
      }),
    );
    expect(out.pending_workspace_calls).toEqual([
      { tool_name: "Workspace_update_widget", input_arguments: { widget_uuid: "w-1" } },
    ]);
  });

  it("keeps no more of the queued FINOS Workspace calls than it has room for", () => {
    const calls = Array.from({ length: 300 }, (_, i) => ({ tool_name: "Workspace_update_widget", input_arguments: { i } }));
    expect(readExtraState(tm({ pending_workspace_calls: calls })).pending_workspace_calls).toHaveLength(100);
  });

  it("returns {} for an array, and ignores keys it does not know", () => {
    expect(readExtraState({ ...tm(), extra_state: [1, 2] as unknown as Record<string, unknown> })).toEqual({});
    expect(readExtraState(tm({ surprise: "x", timezone: "UTC" }))).toEqual({ timezone: "UTC" });
  });
});

describe("makeExtraState", () => {
  it("drops null and undefined values", () => {
    const out = makeExtraState({
      intermediate_context: "x",
      continue_from: undefined,
      traceparent: null as unknown as string | undefined,
    });
    expect(out).toEqual({ intermediate_context: "x" });
  });

  it("drops empty arrays", () => {
    const out = makeExtraState({
      intermediate_citations: [],
      documents_shipped: ["d1"],
    });
    expect(out).toEqual({ documents_shipped: ["d1"] });
  });

  it("drops empty plain objects but keeps non-empty ones", () => {
    const out = makeExtraState({
      copilot_function_call_arguments: {},
    });
    expect(out).toEqual({});

    const out2 = makeExtraState({
      copilot_function_call_arguments: { a: 1 },
    });
    expect(out2).toEqual({ copilot_function_call_arguments: { a: 1 } });
  });

  it("returns {} when every field is empty", () => {
    expect(makeExtraState({})).toEqual({});
  });
});
