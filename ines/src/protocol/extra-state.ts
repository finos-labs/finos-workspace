import { z } from "zod";
import type { Citation, ToolMessage } from "./types";
import type { DocumentCitation } from "../mcp/results";
import type { TurnUsage } from "../lib/token-usage";

export interface ExtraState {
  copilot_function_call_arguments?: Record<string, unknown>;
  intermediate_citations?: Citation[];
  /**
   * The pages of documents that `query_documents` handed to the model, as the tool reported them. They are
   * carried as they are (not as citations) because which of them are cited is decided from the final answer.
   */
  document_hits?: DocumentCitation[];
  intermediate_context?: string;
  continue_from?: string;
  /**
   * Bridge commands the model issued in one step but that could not all be
   * emitted at once (the browser executes exactly one copilotFunctionCall per
   * re-POST). The first is emitted immediately; the rest queue here and the
   * loop drains them one-per-re-POST before re-running the model. Without this the extra
   * calls were silently dropped and only re-run if the model re-issued them —
   * which it does not when it fired them all up front (2026-06-11 trace:
   * 19 update_widget calls, 1 executed, "I updated the widget" hallucinated).
   */
  pending_bridge_calls?: Array<{
    function: string;
    input_arguments: Record<string, unknown>;
  }>;
  /**
   * Calls of the Workspace's tools that the model made in one step, after the first. The browser runs one
   * function call per re-POST, so the first is emitted at once and the rest wait here: the loop makes them one
   * per re-POST, before the model is asked again (as it does the bridge calls above). `tool_name` is the
   * name the model gave the tool (a registered one is checked when a call is made, as this comes back from the browser).
   */
  pending_workspace_calls?: Array<{
    tool_name: string;
    input_arguments: Record<string, unknown>;
  }>;
  loaded_skill_slugs?: string[];
  /**
   * The tool groups the model loaded (or the agent loaded for it) earlier in the turn. A re-POST starts the
   * model call again from the current turn, and without this its tools and their instructions would be gone.
   */
  loaded_tool_groups?: string[];
  /**
   * Document ids already shipped to the ines-tools MCP server's
   * `query_documents` cache for this chat. Persisted across re-POSTs so the
   * agent only ships the delta on the next query_documents call.
   */
  documents_shipped?: string[];
  /**
   * W3C traceparent of the FIRST request in this logical turn. Set once and
   * echoed forward verbatim, so every re-POST joins the same trace with the
   * first request's span as parent. Without it, a turn that round-trips five
   * times produces five disconnected traces, each looking like a turn that
   * stops mid-thought.
   *
   * Untrusted (browser-echoed) — validated by `parseTraceparent` in
   * src/lib/telemetry.ts, which returns null rather than throwing.
   */
  traceparent?: string;
  /**
   * Token usage summed across every re-POST of this turn so far. Per-request
   * counters reset with the generator, so without this the turn total is
   * unknowable.
   *
   * Aliased to `TurnUsage` rather than restated inline: this shape is written
   * by `turnUsageSoFar` and read back by `readTurnUsage`, and a second copy of
   * the field list drifts silently the next time a counter is added.
   */
  turn_usage?: TurnUsage;
  /**
   * The user's IANA timezone, echoed forward for the rest of the turn.
   *
   * The Workspace sends `timezone` on the initial POST but not on a round-trip
   * re-POST. `buildDateSection` used to append a "User timezone: ..." line only
   * when it had one, so the system prompt gained a 32-byte tail on fresh POSTs
   * and lost it on reboot POSTs — two alternating prefixes, two prompt-cache
   * lineages (measured 2026-08-19: 21960 vs 21928 bytes, identical for the
   * first 99.9%). Carrying it here keeps one prefix.
   *
   * It also fixes a correctness bug the cache miss exposed: without it a
   * re-POST rendered CURRENT DATE in UTC, which is the wrong day for a user
   * west of Greenwich for the last hours of their day.
   *
   * Untrusted (browser-echoed) — validated by `resolveTimezone` in
   * src/agent/prompt.ts, which falls back to UTC rather than throwing.
   */
  timezone?: string;
}

// The browser echoes extra_state back, so everything in it is whatever a client chose to send: it is read
// field by field, a field of the wrong shape is dropped (as if absent), an element of a list of the wrong
// shape is dropped, and every list and string has a limit. Nothing here can make a request fail.
const MAX_LIST = 500;
const MAX_CITATIONS = 200;
const MAX_TEXT = 200_000;

const boundedString = (max: number) => z.string().max(max);
const record = z.record(z.string(), z.unknown());

const citationSchema = z.union([
  z.looseObject({
    id: boundedString(200),
    source_info: z.looseObject({
      type: z.literal("widget"),
      metadata: z.looseObject({ input_args: record, widget_uuid: boundedString(200) }),
    }),
    details: z.array(record).max(50),
  }),
  z.looseObject({
    id: boundedString(200),
    source_info: z.looseObject({ type: z.enum(["web", "file"]), name: boundedString(2_000) }),
    details: z.array(record).max(50),
  }),
]);

const documentHitSchema = z.object({
  id: boundedString(200),
  type: z.literal("document"),
  uri: boundedString(2_000),
  title: boundedString(2_000),
  page: z.number().int().min(1).max(100_000).optional(),
  score: z.number().min(-1).max(1).optional(),
});

const bridgeCallSchema = z.object({ function: boundedString(100), input_arguments: record });
const workspaceCallSchema = z.object({ tool_name: boundedString(200), input_arguments: record });

/** The elements of a list that have the shape, at most `max` of them; nothing when it is no list. */
function elementsOf<T>(raw: unknown, element: z.ZodType<T>, max: number): T[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.slice(0, max).flatMap((item) => {
    const parsed = element.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

function valueOf<T>(raw: unknown, schema: z.ZodType<T>): T | undefined {
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export function readExtraState(toolMsg: ToolMessage): ExtraState {
  const raw = toolMsg.extra_state;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const names = boundedString(500);
  const state: ExtraState = {
    copilot_function_call_arguments: valueOf(r.copilot_function_call_arguments, record),
    intermediate_citations: elementsOf(r.intermediate_citations, citationSchema, MAX_CITATIONS) as Citation[] | undefined,
    document_hits: elementsOf(r.document_hits, documentHitSchema, MAX_CITATIONS),
    intermediate_context: valueOf(r.intermediate_context, boundedString(MAX_TEXT)),
    continue_from: valueOf(r.continue_from, boundedString(MAX_TEXT)),
    pending_bridge_calls: elementsOf(r.pending_bridge_calls, bridgeCallSchema, 100),
    pending_workspace_calls: elementsOf(r.pending_workspace_calls, workspaceCallSchema, 100),
    loaded_skill_slugs: elementsOf(r.loaded_skill_slugs, names, 100),
    loaded_tool_groups: elementsOf(r.loaded_tool_groups, names, 50),
    documents_shipped: elementsOf(r.documents_shipped, names, MAX_LIST),
    traceparent: valueOf(r.traceparent, boundedString(200)),
    // Read by readTurnUsage, which validates it.
    turn_usage: r.turn_usage as ExtraState["turn_usage"],
    timezone: valueOf(r.timezone, boundedString(100)),
  };
  // A field that was absent or was dropped is not a key.
  return Object.fromEntries(Object.entries(state).filter(([, value]) => value !== undefined)) as ExtraState;
}

export function makeExtraState(state: ExtraState): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(state)) {
    if (v == null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0) continue;
    out[k] = v;
  }
  return out;
}
