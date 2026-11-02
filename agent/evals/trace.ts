import { runAgentLoop } from "../src/agent/loop.ts";
import type {
  AgentTool,
  QueryRequest,
  SkillCatalogEntry,
  SkillPayload,
  SSEEvent,
  UploadedDocument,
  Widget,
  WorkspaceState,
} from "../src/protocol/types.ts";
import type { LanguageModel } from "ai";

interface CapturedToolCall {
  name: string;
  args: Record<string, unknown>;
  parameters: Record<string, unknown>;
  serverToolName?: string;
}

export interface Trace {
  caseId: string;
  trial: number;
  events: SSEEvent[];
  toolCalls: CapturedToolCall[];
  finalText: string;
  textChunks: string[];
  citations: Array<Record<string, unknown>>;
  durationMs: number;
  errored: boolean;
  errorMessage?: string;
}

interface RunCaseInput {
  caseId: string;
  trial: number;
  model: LanguageModel;
  messages: QueryRequest["messages"];
  widgets?: { primary?: Widget[]; secondary?: Widget[]; extra?: Widget[] };
  workspaceState?: WorkspaceState | null;
  tools?: AgentTool[];
  conversationId?: string;
  rawModelId?: string;
  promptSuggestionsEnabled?: boolean;
  suggestionsVia?: "inline" | "tool";
  skillsCatalog?: SkillCatalogEntry[];
  selectedSkills?: SkillPayload[];
  urls?: string[];
  context?: unknown[];
  documents?: UploadedDocument[];
  timezone?: string;
}

function extractToolCalls(events: SSEEvent[]): CapturedToolCall[] {
  const calls: CapturedToolCall[] = [];
  const seenInProc = new Set<string>();
  for (const e of events) {
    if (e.event === "copilotFunctionCall") {
      const data = e.data as { function: string; input_arguments?: Record<string, unknown> };
      const args = data.input_arguments ?? {};
      if (data.function === "execute_agent_tool") {
        const params = (args.parameters ?? {}) as Record<string, unknown>;
        const serverToolName = args.tool_name as string | undefined;
        calls.push({ name: data.function, args, parameters: params, serverToolName });
      } else {
        calls.push({ name: data.function, args, parameters: args });
      }
      continue;
    }
    if (e.event === "copilotStatusUpdate") {
      const data = e.data as {
        tool_call?: Record<string, unknown>;
        details?: Array<Record<string, unknown>> | Record<string, unknown>;
      };
      const directToolCall = data.tool_call;
      if (directToolCall) {
        const toolName = directToolCall.tool_name as string | undefined;
        if (toolName) {
          const input = (directToolCall.input ?? {}) as Record<string, unknown>;
          const dedupeKey = `${toolName}|${JSON.stringify(input)}`;
          if (!seenInProc.has(dedupeKey)) {
            seenInProc.add(dedupeKey);
            calls.push({ name: toolName, args: input, parameters: input });
          }
        }
        continue;
      }
      const detailList = Array.isArray(data.details)
        ? data.details
        : data.details
          ? [data.details]
          : [];
      for (const detail of detailList) {
        const toolName = detail.tool_name as string | undefined;
        if (!toolName) continue;
        const input = (detail.input ?? {}) as Record<string, unknown>;
        const dedupeKey = `${toolName}|${JSON.stringify(input)}`;
        if (seenInProc.has(dedupeKey)) continue;
        seenInProc.add(dedupeKey);
        calls.push({ name: toolName, args: input, parameters: input });
      }
    }
  }
  return calls;
}

function extractTextChunks(events: SSEEvent[]): string[] {
  const out: string[] = [];
  for (const e of events) {
    if (e.event === "copilotMessageChunk") {
      out.push((e.data as { delta: string }).delta);
    }
  }
  return out;
}

function extractCitations(events: SSEEvent[]): Array<Record<string, unknown>> {
  const cit = events.find((e) => e.event === "copilotCitationCollection");
  if (!cit) return [];
  return (cit.data as { citations: Array<Record<string, unknown>> }).citations ?? [];
}

export async function runEvalCase(input: RunCaseInput): Promise<Trace> {
  const startedAt = Date.now();
  const events: SSEEvent[] = [];
  let errored = false;
  let errorMessage: string | undefined;

  try {
    for await (const e of runAgentLoop({
      request: {
        messages: input.messages,
        widgets: input.widgets,
        tools: input.tools,
        skills_catalog: input.skillsCatalog,
        selected_skills: input.selectedSkills,
        urls: input.urls,
        context: input.context,
        documents: input.documents,
        timezone: input.timezone,
      } as QueryRequest,
      rawModelId: input.rawModelId ?? process.env.EVAL_MODEL ?? process.env.DEFAULT_MODEL ?? "",
      model: input.model,
      allWidgets: [
        ...(input.widgets?.primary ?? []),
        ...(input.widgets?.secondary ?? []),
        ...(input.widgets?.extra ?? []),
      ],
      workspaceState: input.workspaceState ?? null,
      promptSuggestionsEnabled: input.promptSuggestionsEnabled ?? false,
      suggestionsVia: input.suggestionsVia ?? "inline",
      conversationId: input.conversationId ?? `eval-${input.caseId}-${input.trial}`,
    })) {
      events.push(e);
    }
  } catch (err) {
    errored = true;
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  const textChunks = extractTextChunks(events);
  return {
    caseId: input.caseId,
    trial: input.trial,
    events,
    toolCalls: extractToolCalls(events),
    finalText: textChunks.join(""),
    textChunks,
    citations: extractCitations(events),
    durationMs: Date.now() - startedAt,
    errored,
    errorMessage,
  };
}
