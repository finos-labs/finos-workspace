import type { ZodType } from "zod";
import { createApp, HELPER_BODY_BYTES, HELPER_JSON_PATHS, TRANSCRIBE_BODY_BYTES } from "../../src/app.ts";
import { createLimits } from "../../src/auth/limits.ts";
import { READY_TIMEOUT_MS } from "../../src/auth/workspace-client.ts";
import { ENV_REFERENCE } from "../../src/lib/env-reference.ts";
import { loadConfig } from "../../src/lib/config.ts";
import { createLocalStore } from "../../src/lib/store.ts";
import {
  CHAT_TITLE_FALLBACK,
  CHAT_TITLE_MESSAGE_CHARS,
  CHAT_TITLE_MESSAGES,
  ChatTitleSchema,
} from "../../src/routes/generate/chat-title.ts";
import { GenerateCodeSchema } from "../../src/routes/generate/code.ts";
import {
  DASHBOARD_TITLE_FALLBACK,
  DASHBOARD_TITLE_NAME_CHARS,
  DASHBOARD_TITLE_WIDGETS,
  DashboardTitleSchema,
} from "../../src/routes/generate/dashboard-title.ts";
import {
  ENHANCE_WIDGET_NAME_CHARS,
  ENHANCE_WIDGET_NAMES,
  EnhancePromptSchema,
} from "../../src/routes/generate/enhance-prompt.ts";
import { MAX_HELPER_TEXT_CHARS } from "../../src/routes/generate/helper.ts";
import { MAX_FILE_SIZE, WIDGET_SAMPLE_CHARS, WidgetInfoSchema } from "../../src/routes/generate/widget-info.ts";
import { MAX_AUDIO_BYTES } from "../../src/routes/transcribe.ts";
import { type SchemaField, schemaFields } from "./schema.ts";

interface RouteReference {
  summary: string;
  helper?: { request: ZodType | null; detail: string; answer: string; fallback: string };
}

const MEBIBYTE = 1024 * 1024;

export const ROUTE_REFERENCE: Record<string, RouteReference> = {
  "GET /": { summary: "Answers with the text Agent." },
  "GET /agents.json": {
    summary: "The agent's descriptor, which the Workspace reads to learn the agent's name, skills and features.",
  },
  "GET /status": {
    summary:
      'Answers {"status": "ok", "timestamp": ..., "sharedState": ...}. sharedState is true when the agent keeps its state in Redis, which a deployment with more than one replica needs.',
  },
  "GET /ready": {
    summary:
      `Answers {"status": "ready"}. With authentication on, the agent first calls the /health route of the Workspace API with a timeout of ${READY_TIMEOUT_MS / 1000} seconds, ` +
      'and when that fails it answers 503 with {"status": "not ready", "reason": "the Workspace API does not answer"}.',
  },
  "POST /v1/query": { summary: "Asks a question. The answer is a stream of events, as the agent query protocol describes." },
  "POST /v1/generate/chat/title": {
    summary: "Names a chat.",
    helper: {
      request: ChatTitleSchema,
      detail: `The agent reads the last ${CHAT_TITLE_MESSAGES} messages that have the role human, each cut to ${CHAT_TITLE_MESSAGE_CHARS} characters.`,
      answer: 'A JSON string that holds the title, for example "Revenue by region".',
      fallback: `"${CHAT_TITLE_FALLBACK}", also when there is no human message.`,
    },
  },
  "POST /v1/generate/dashboard/title": {
    summary: "Names a dashboard.",
    helper: {
      request: DashboardTitleSchema,
      detail: `The agent reads the first ${DASHBOARD_TITLE_WIDGETS} widget names, each cut to ${DASHBOARD_TITLE_NAME_CHARS} characters.`,
      answer: "Plain text, the title.",
      fallback: `${DASHBOARD_TITLE_FALLBACK}, also when no widget has a name.`,
    },
  },
  "POST /v1/enhance_prompt": {
    summary: "Rewrites a question to be more specific.",
    helper: {
      request: EnhancePromptSchema,
      detail:
        `The agent rewrites the last human message, cut to ${MAX_HELPER_TEXT_CHARS.toLocaleString("en-US")} characters, ` +
        `and uses the names of up to ${ENHANCE_WIDGET_NAMES} widgets, each cut to ${ENHANCE_WIDGET_NAME_CHARS} characters, as hints.`,
      answer: "Plain text, the rewritten question.",
      fallback: "The original question, or an empty string when there is no human message.",
    },
  },
  "POST /v1/generate/widget_info": {
    summary: "Describes and classifies a widget from a sample of its data.",
    helper: {
      request: WidgetInfoSchema,
      detail: `The agent reads the first ${WIDGET_SAMPLE_CHARS.toLocaleString("en-US")} characters of widget_data.`,
      answer: "A JSON object with title, description, category and subcategory.",
      fallback: "An object made from the request's own name, description and metadata, with the category Other.",
    },
  },
  "POST /v1/generate/widget_info/file": {
    summary: "Describes an uploaded file.",
    helper: {
      request: null,
      detail:
        `The request is a multipart form with the field file, at most ${MAX_FILE_SIZE / MEBIBYTE} MiB, ` +
        `and the agent reads its first ${WIDGET_SAMPLE_CHARS.toLocaleString("en-US")} characters. ` +
        "A form without the field is answered with 400 and a file that is too large with 413.",
      answer: "A JSON object with title and description.",
      fallback: "The file's name without its extension as the title, and the file's name as the description.",
    },
  },
  "POST /v1/generate/code": {
    summary: "Writes or changes SQL or Python code for a widget.",
    helper: {
      request: GenerateCodeSchema,
      detail: "The language is sql or python.",
      answer: '{"success": true, "generated_code": "..."} or {"success": false, "error_message": "..."}.',
      fallback: '{"success": false, "error_message": "Code generation failed"}.',
    },
  },
  "POST /v1/transcribe": {
    summary: "Turns a recording into text.",
  },
};

export interface RouteEntry {
  method: string;
  path: string;
  needsToken: boolean;
  helperCalls: boolean;
  bodyLimitBytes: number | "AGENT_MAX_BODY_MB";
  summary: string;
}

export interface HelperEntry {
  path: string;
  fields: SchemaField[];
  detail: string;
  answer: string;
  fallback: string;
}

export interface RoutesReference {
  routes: RouteEntry[];
  helpers: HelperEntry[];
  limits: { helperBodyBytes: number; transcribeBodyBytes: number; audioBytes: number; defaultMaxBodyMb: number };
}

function matches(pattern: string, path: string): boolean {
  return pattern.endsWith("/*") ? path.startsWith(pattern.slice(0, -1)) : pattern === path;
}

export function collectRoutes(): RoutesReference {
  const config = loadConfig({ AGENT_AUTH: "none" });
  const store = createLocalStore();
  const app = createApp({ config, workspace: null, store, limits: createLimits({ store, maxConcurrent: 4 }) });

  const gates = app.routes.filter((route) => route.method === "ALL" && route.handler.name === "helperGate");
  const endpoints = app.routes.filter((route) => route.method !== "ALL");

  const routes = endpoints.map((route): RouteEntry => {
    const key = `${route.method} ${route.path}`;
    const reference = ROUTE_REFERENCE[key];
    if (!reference) throw new Error(`The route ${key} has no entry in ROUTE_REFERENCE`);
    let bodyLimitBytes: RouteEntry["bodyLimitBytes"] = "AGENT_MAX_BODY_MB";
    if (route.path === "/v1/transcribe") bodyLimitBytes = TRANSCRIBE_BODY_BYTES;
    else if (HELPER_JSON_PATHS.includes(route.path)) bodyLimitBytes = HELPER_BODY_BYTES;
    return {
      method: route.method,
      path: route.path,
      needsToken: route.path.startsWith("/v1/"),
      helperCalls: gates.some((gate) => matches(gate.path, route.path)),
      bodyLimitBytes,
      summary: reference.summary,
    };
  });

  const known = new Set(endpoints.map((route) => `${route.method} ${route.path}`));
  for (const key of Object.keys(ROUTE_REFERENCE)) {
    if (!known.has(key)) throw new Error(`ROUTE_REFERENCE has ${key}, which the app does not serve`);
  }

  const helpers = endpoints.flatMap((route): HelperEntry[] => {
    const helper = ROUTE_REFERENCE[`${route.method} ${route.path}`]?.helper;
    if (!helper) return [];
    return [
      {
        path: route.path,
        fields: helper.request ? schemaFields(helper.request) : [],
        detail: helper.detail,
        answer: helper.answer,
        fallback: helper.fallback,
      },
    ];
  });

  const maxBody = ENV_REFERENCE.find((entry) => entry.name === "AGENT_MAX_BODY_MB");
  return {
    routes,
    helpers,
    limits: {
      helperBodyBytes: HELPER_BODY_BYTES,
      transcribeBodyBytes: TRANSCRIBE_BODY_BYTES,
      audioBytes: MAX_AUDIO_BYTES,
      defaultMaxBodyMb: Number(maxBody?.default),
    },
  };
}
