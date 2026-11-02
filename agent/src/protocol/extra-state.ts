import { z } from "zod";
import type { Citation, ToolMessage } from "./types.ts";
import type { DocumentCitation } from "../mcp/results.ts";
import type { TurnUsage } from "../lib/token-usage.ts";

export const EXTRA_STATE_KEYS = [
  "copilot_function_call_arguments",
  "intermediate_citations",
  "document_hits",
  "documents_shipped",
  "loaded_skill_slugs",
  "loaded_tool_groups",
  "pending_bridge_calls",
  "pending_workspace_calls",
  "traceparent",
  "turn_usage",
  "timezone",
] as const satisfies readonly (keyof ExtraState)[];

interface ExtraState {
  copilot_function_call_arguments?: Record<string, unknown>;
  intermediate_citations?: Citation[];
  document_hits?: DocumentCitation[];
  pending_bridge_calls?: Array<{
    function: string;
    input_arguments: Record<string, unknown>;
  }>;
  pending_workspace_calls?: Array<{
    tool_name: string;
    input_arguments: Record<string, unknown>;
  }>;
  loaded_skill_slugs?: string[];
  loaded_tool_groups?: string[];
  documents_shipped?: string[];
  traceparent?: string;
  turn_usage?: TurnUsage;
  timezone?: string;
}

const MAX_LIST = 500;
const MAX_CITATIONS = 200;

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
    pending_bridge_calls: elementsOf(r.pending_bridge_calls, bridgeCallSchema, 100),
    pending_workspace_calls: elementsOf(r.pending_workspace_calls, workspaceCallSchema, 100),
    loaded_skill_slugs: elementsOf(r.loaded_skill_slugs, names, 100),
    loaded_tool_groups: elementsOf(r.loaded_tool_groups, names, 50),
    documents_shipped: elementsOf(r.documents_shipped, names, MAX_LIST),
    traceparent: valueOf(r.traceparent, boundedString(200)),
    turn_usage: r.turn_usage as ExtraState["turn_usage"],
    timezone: valueOf(r.timezone, boundedString(100)),
  };
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
