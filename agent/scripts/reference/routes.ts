import { createApp, HELPER_BODY_BYTES, HELPER_JSON_PATHS, TRANSCRIBE_BODY_BYTES } from "../../src/app.ts";
import { createLimits } from "../../src/auth/limits.ts";
import { ENV_REFERENCE } from "../../src/lib/env-reference.ts";
import { assertRoutesMatch, type RouteDefinition } from "../../src/lib/openapi.ts";
import { loadConfig } from "../../src/lib/config.ts";
import { createLocalStore } from "../../src/lib/store.ts";
import { ROUTE_DEFINITIONS } from "../../src/routes/definitions.ts";
import { MAX_AUDIO_BYTES } from "../../src/routes/transcribe.ts";
import { type SchemaField, schemaFields } from "./schema.ts";

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

function definitionFor(key: string, definitions: RouteDefinition[]): RouteDefinition {
  const definition = definitions.find((entry) => `${entry.method} ${entry.path}` === key);
  if (definition === undefined) throw new Error(`The route ${key} has no definition`);
  return definition;
}

export function collectRoutes(): RoutesReference {
  const config = loadConfig({ AGENT_AUTH: "none" });
  const store = createLocalStore();
  const app = createApp({ config, workspace: null, store, limits: createLimits({ store, maxConcurrent: 4 }) });

  const gates = app.routes.filter((route) => route.method === "ALL" && route.handler.name === "helperGate");
  const endpoints = app.routes.filter((route) => route.method !== "ALL");

  assertRoutesMatch(endpoints, ROUTE_DEFINITIONS);

  const routes = endpoints.map((route): RouteEntry => {
    const definition = definitionFor(`${route.method} ${route.path}`, ROUTE_DEFINITIONS);
    let bodyLimitBytes: RouteEntry["bodyLimitBytes"] = "AGENT_MAX_BODY_MB";
    if (route.path === "/v1/transcribe") bodyLimitBytes = TRANSCRIBE_BODY_BYTES;
    else if (HELPER_JSON_PATHS.includes(route.path)) bodyLimitBytes = HELPER_BODY_BYTES;
    return {
      method: route.method,
      path: route.path,
      needsToken: definition.secured,
      helperCalls: gates.some((gate) => matches(gate.path, route.path)),
      bodyLimitBytes,
      summary: definition.summary,
    };
  });

  const helpers = ROUTE_DEFINITIONS.flatMap((definition): HelperEntry[] => {
    const helper = definition.helper;
    if (helper === undefined) return [];
    const schema = definition.request?.schema.zod;
    return [
      {
        path: definition.path,
        fields: schema === undefined ? [] : schemaFields(schema),
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
