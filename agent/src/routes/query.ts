import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AgentTool, QueryRequest, SSEEvent, ToolMessage, WorkspaceState } from "../protocol/types.ts";
import { sseResponse } from "../protocol/stream.ts";
import { messageChunk, reasoningStep } from "../protocol/events.ts";
import { getTieredWidgets } from "../widgets/tiers.ts";
import { resolveModel } from "../lib/providers.ts";
import { getLogger, withContext } from "../lib/logger.ts";
import { metrics } from "../lib/metrics.ts";
import { scopeKey } from "../lib/scope.ts";
import type { UsageCounts } from "../lib/token-usage.ts";
import { ANONYMOUS, type AppEnv, type Principal, type Services } from "../auth/middleware.ts";
import type { Capability, Failure, ToolRef } from "../auth/workspace-client.ts";
import { runAgentLoop, cacheWidgetItemsFromReboot } from "../agent/loop.ts";
import { WORKSPACE_BRIDGE_COMMAND_NAMES } from "../protocol/bridge-commands.ts";
import { AGENT_ID } from "./agents.ts";

const logger = getLogger(["app", "routes", "query"]);
const audit = getLogger(["audit"]);

const LIMITS = { messages: 20_000, widgets: 20_000, tools: 500, skills: 500, pluginArtifacts: 100, documents: 50 } as const;

const MessageSchema = z.object({ role: z.enum(["human", "ai", "tool"]) }).passthrough();
const WidgetSchema = z
  .object({
    uuid: z.string().max(500).optional(),
    origin: z.string().max(500).optional(),
    widget_id: z.string().max(500).optional(),
    name: z.string().max(2_000).optional(),
    description: z.string().max(50_000).optional(),
    params: z.array(z.object({}).passthrough()).max(1_000).optional(),
    category: z.string().max(500).optional(),
    sub_category: z.string().max(500).optional(),
    source: z.string().max(500).nullish(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    mcp_tool: z
      .object({
        server_id: z.string().max(500),
        tool_name: z.string().max(500),
        args: z
          .record(z.string().max(200), z.union([z.string().max(256), z.number(), z.boolean()]))
          .refine((args) => Object.keys(args).length <= 32, "Too many arguments")
          .optional(),
      })
      .optional(),
  })
  .passthrough();

const QueryRequestSchema = z.object({
  messages: z.array(MessageSchema).min(1).max(LIMITS.messages),
  model: z.string().max(200).optional(),
  widgets: z
    .object({
      primary: z.array(WidgetSchema).max(LIMITS.widgets).optional(),
      secondary: z.array(WidgetSchema).max(LIMITS.widgets).optional(),
      extra: z.array(WidgetSchema).max(LIMITS.widgets).optional(),
    })
    .optional(),
  context: z.unknown().refine((v) => !Array.isArray(v) || v.length <= 500, "Too many context items").optional(),
  urls: z.array(z.string().max(4_000)).max(8).optional(),
  timezone: z.string().max(100).optional(),
  workspace_state: z.unknown().optional(),
  workspace_options: z
    .record(z.string().max(100), z.union([z.boolean(), z.string().max(500)]))
    .refine((o) => Object.keys(o).length <= 100, "Too many options")
    .optional(),
  skills_catalog: z
    .array(z.object({ slug: z.string().max(200), description: z.string().max(4_000), updatedAt: z.string().max(100).optional() }))
    .max(LIMITS.skills)
    .optional(),
  plugin_artifacts: z
    .array(
      z.object({
        plugin: z.string().max(100),
        widget: z.string().max(100),
        name: z.string().max(500),
        description: z.string().max(4_000),
        data_schema: z.record(z.string(), z.unknown()),
        config_schema: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .max(LIMITS.pluginArtifacts)
    .optional(),
  selected_skills: z
    .array(z.object({
      slug: z.string().max(200),
      description: z.string().max(4_000),
      contentMarkdown: z.string().max(500_000).optional(),
      source: z.enum(["forced_slash", "model_selected"]),
    }))
    .max(20)
    .optional(),
  tools: z
    .array(z.object({
      name: z.string().max(500),
      tool_name: z.string().max(500).optional(),
      server_id: z.string().max(500),
      url: z.string().max(4_000),
      description: z.string().max(20_000).optional(),
      input_schema: z.object({
        properties: z
          .record(z.string(), z.record(z.string(), z.unknown()))
          .refine((p) => Object.keys(p).length <= 200, "Too many properties")
          .optional(),
        required: z.array(z.string().max(200)).max(200).optional(),
      }).optional(),
    }))
    .max(LIMITS.tools)
    .optional(),
  documents: z
    .array(
      z.object({
        id: z.string().max(200),
        name: z.string().max(500),
        format: z.enum(["pdf", "docx", "txt", "md", "html"]),
        content_b64: z.string().max(35_000_000).optional(),
        url: z.string().max(4_000).optional(),
      }).refine((d) => !!d.content_b64 || !!d.url, {
        message: "Document must have either content_b64 or url",
      }),
    )
    .max(LIMITS.documents)
    .optional(),
});

const WorkspaceStateSchema = z.object({
  current_page_context: z.string(),
  current_dashboard_uuid: z.string().optional(),
  current_dashboard_info: z.object({
    id: z.string(),
    name: z.string().optional(),
    current_tab_id: z.string(),
    tabs: z.array(z.object({
      tab_id: z.string(),
      widgets: z.array(z.object({
        widget_uuid: z.string(),
        name: z.string().optional(),
      })).optional(),
    })).optional(),
  }).nullish(),
  action_history: z.array(z.string()).optional(),
}).passthrough();

function parseWorkspaceState(raw: unknown): WorkspaceState | null {
  const result = WorkspaceStateSchema.safeParse(raw);
  return result.success ? result.data : null;
}

function modelFailure(message: string): Response {
  logger.error("No usable model for this request", { message });
  return sseResponse(
    (async function* () {
      yield reasoningStep(message, "ERROR");
      yield messageChunk(message);
    })(),
  );
}

function chatNotice(message: string): Response {
  return sseResponse(
    (async function* () {
      yield messageChunk(message);
    })(),
  );
}

function toolRef(tool: AgentTool): ToolRef {
  return { url: tool.url, toolName: tool.tool_name ?? tool.name.split("_").slice(1).join("_") };
}

function refusal(c: Context<AppEnv>, failure: Failure): Response {
  if (failure.reason === "limit") {
    metrics.queries.inc({ outcome: "limit" });
    audit.info("Refused a query: the usage limit is reached");
    return chatNotice(failure.message);
  }
  if (failure.reason === "rejected") return c.json({ error: "Not signed in" }, 401);
  return c.json({ error: "The FINOS Workspace API is not available" }, 503);
}

interface QueryRun {
  context: Record<string, unknown>;
  chatKey: string;
  services: Services | undefined;
  release: () => void;
  tokens: () => number;
}

function trackQuery(run: QueryRun) {
  const started = performance.now();
  metrics.activeQueries.inc();
  let outcome: string | null = null;
  let sawFunctionCall = false;
  let ended = false;

  function end(fallback: string): void {
    if (ended) return;
    ended = true;
    const result = outcome ?? fallback;
    if (result !== "continued" && run.chatKey) void run.services?.limits.endTurn(run.chatKey);
    const seconds = (performance.now() - started) / 1000;
    metrics.activeQueries.dec();
    metrics.queries.inc({ outcome: result });
    metrics.queryDuration.observe(seconds, { outcome: result });
    run.release();
    withContext(run.context, () =>
      audit.info("Query {outcome}", { outcome: result, tokens: run.tokens(), durationMs: Math.round(seconds * 1000) }),
    );
  }

  async function* events(inner: AsyncGenerator<SSEEvent>): AsyncGenerator<SSEEvent> {
    try {
      while (true) {
        const step = await withContext(run.context, () => inner.next());
        if (step.done) break;
        if (step.value.event === "copilotFunctionCall") sawFunctionCall = true;
        yield step.value;
      }
      outcome = sawFunctionCall ? "continued" : "completed";
    } catch (error) {
      outcome = "error";
      throw error;
    } finally {
      await withContext(run.context, () => inner.return(undefined)).catch(() => undefined);
      end("aborted");
    }
  }

  return { events, end };
}

export const queryRouter = new Hono<AppEnv>();

queryRouter.post("/v1/query", async (c) => {
  const services = c.get("services") as Services | undefined;
  const principal = c.get("principal") ?? ANONYMOUS;

  if (services && (await services.limits.struck(principal.userId))) {
    metrics.queries.inc({ outcome: "limit" });
    audit.info("Refused a query unread: the user has sent too many requests that were not questions");
    return c.json({ error: "Too many invalid requests. Try again in a minute." }, 429, { "Retry-After": "60" });
  }

  const admission = services ? await services.limits.admit(principal.userId) : ({ ok: true, release: () => undefined } as const);
  if (!admission.ok) {
    metrics.queries.inc({ outcome: "busy" });
    if (admission.reason === "server") {
      audit.info("Refused a query: the agent is running as many as it can");
      c.header("Retry-After", "5");
      return c.json({ error: "The agent is busy. Try again in a moment." }, 503);
    }
    audit.info("Refused a query: the user has too many running");
    return c.json({ error: "Too many of your queries are running. Wait for one to finish." }, 429);
  }

  let streaming = false;
  try {
    return await answerQuery(c, { services, principal, release: admission.release, handOver: () => void (streaming = true) });
  } finally {
    if (!streaming) admission.release();
  }
});

async function answerQuery(
  c: Context<AppEnv>,
  { services, principal, release, handOver }: { services: Services | undefined; principal: Principal; release: () => void; handOver: () => void },
): Promise<Response> {
  let raw: Record<string, unknown>;
  try {
    raw = await c.req.json();
  } catch {
    void services?.limits.strike(principal.userId);
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const parsed = QueryRequestSchema.safeParse(raw);
  if (!parsed.success) {
    void services?.limits.strike(principal.userId);
    logger.error("Invalid request", { issues: parsed.error.issues });
    metrics.queries.inc({ outcome: "invalid" });
    return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
  }
  const body = raw as unknown as QueryRequest;

  const workspace = services?.workspace ?? null;

  const lastMessage = body.messages.at(-1);
  const opts = (raw.workspace_options ?? {}) as Record<string, boolean | string>;
  const hasOption = (key: string): boolean => Boolean(opts[key]);
  const getOption = (key: string): string | undefined => {
    const v = opts[key];
    return typeof v === "string" ? v : undefined;
  };

  const rawModelId = getOption("model") || process.env.DEFAULT_MODEL;
  if (!rawModelId) {
    return modelFailure("No model is configured. Set DEFAULT_MODEL on the agent (for example <provider>:<model>) or pick a model in the FINOS Workspace.");
  }
  if (services && !services.config.models.includes(rawModelId)) {
    metrics.queries.inc({ outcome: "denied" });
    audit.info("Refused the model {model}: this deployment does not offer it", { model: rawModelId });
    return chatNotice(`The model ${rawModelId} is not available here.`);
  }
  let model: ReturnType<typeof resolveModel>;
  try {
    model = resolveModel(rawModelId);
  } catch (err) {
    return modelFailure(err instanceof Error ? err.message : String(err));
  }
  const workspaceState = parseWorkspaceState(body.workspace_state);

  const chatId = c.req.header("X-Trace-Id") ?? c.req.header("x-trace-id") ?? "";
  const conversationId = workspace ? scopeKey(principal.userId, chatId) : chatId;

  let disabledCapabilities: Capability[] = [];
  if (workspace && services) {
    try {
      const authorization = await workspace.authorize(principal.token, {
        agentId: AGENT_ID,
        model: rawModelId,
        tools: (body.tools ?? []).map(toolRef),
      });
      if (!authorization.ok) {
        release();
        return refusal(c, authorization);
      }
      if (authorization.value.deniedModel) {
        release();
        metrics.queries.inc({ outcome: "denied" });
        audit.info("Refused the model {model}: the user's roles do not allow it", { model: rawModelId });
        return chatNotice(`Your role does not allow the model ${rawModelId}.`);
      }
      disabledCapabilities = authorization.value.disabledCapabilities;
      if (authorization.value.deniedTools.length > 0 && body.tools) {
        const denied = new Set(authorization.value.deniedTools.map((t) => `${t.url}\u0000${t.toolName}`));
        body.tools = body.tools.filter((t) => !denied.has(`${t.url}\u0000${toolRef(t).toolName}`));
        audit.info("Left out {count} tools the user's roles do not allow", { count: denied.size });
      }

      const continuing = lastMessage?.role === "tool" && !!conversationId && (await services.limits.inTurn(conversationId));
      if (continuing && !(await services.limits.noteRequest(conversationId))) {
        release();
        metrics.queries.inc({ outcome: "limit" });
        audit.info("Refused a continuation: the turn has used all the requests it may");
        return chatNotice("This question needed more steps than one question may take, so it was stopped. Ask for less at a time.");
      }
      if (!continuing) {
        const counted = await workspace.recordQuery(principal.token);
        if (!counted.ok) {
          release();
          return refusal(c, counted);
        }
        if (conversationId) await services.limits.startTurn(conversationId);
      }
    } catch (error) {
      release();
      throw error;
    }
  }

  const tieredWidgets = getTieredWidgets(body);
  const allWidgets = tieredWidgets.map((t) => t.widget);

  if (lastMessage?.role === "tool") {
    const toolMsg = lastMessage as ToolMessage;
    if (
      toolMsg.function !== "get_skill_content" &&
      toolMsg.function !== "execute_agent_tool" &&
      toolMsg.function !== "get_params_options" &&
      !WORKSPACE_BRIDGE_COMMAND_NAMES.has(toolMsg.function)
    ) {
      try {
        await cacheWidgetItemsFromReboot(toolMsg, allWidgets, conversationId);
      } catch (error) {
        release();
        throw error;
      }
    }
  }

  const roles = body.messages.map((m) => m.role);
  const optionsModel = getOption("model");
  const modelSource = optionsModel ? "workspace_options.model" : "env.DEFAULT_MODEL";
  const context = {
    user: principal.userId,
    conversationId: conversationId || "(missing)",
    model: rawModelId,
  };
  withContext(context, () =>
    logger.info(
      "Query received: model {model} (via {modelSource}), {widgetCount} widgets, {mcpToolCount} tools",
      {
        model: rawModelId,
        modelSource,
        roles,
        widgetCount: allWidgets.length,
        mcpToolCount: (body.tools ?? []).length,
      },
    ),
  );

  const promptSuggestionsEnabled = hasOption("prompt-suggestions");

  let tokens = 0;
  const onUsage = (usage: UsageCounts) => {
    tokens = usage.totalTokens;
    metrics.modelTokens.inc({ direction: "input" }, usage.inputTokens);
    metrics.modelTokens.inc({ direction: "output" }, usage.outputTokens);
    if (workspace) void workspace.recordTokens(principal.token, usage.totalTokens);
  };

  const query = trackQuery({ context, chatKey: conversationId, services, release, tokens: () => tokens });
  handOver();
  const clientGone = new AbortController();
  return sseResponse(
    query.events(
      runAgentLoop({
        request: body,
        rawModelId,
        model,
        allWidgets,
        tieredWidgets,
        workspaceState,
        promptSuggestionsEnabled,
        conversationId,
        scopeSecret: services?.config.scopeSecret ?? null,
        disabledCapabilities,
        onUsage,
        signal: clientGone.signal,
      }),
    ),
    () => query.end("aborted"),
    () => clientGone.abort(),
  );
}
