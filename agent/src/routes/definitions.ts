import { readyRoute } from "../app.ts";
import type { RouteDefinition, TagDescription } from "../lib/openapi.ts";
import { agentsDescriptorRoute, agentsRootRoute } from "./agents.ts";
import { chatTitleRoute } from "./generate/chat-title.ts";
import { codeRoute } from "./generate/code.ts";
import { dashboardTitleRoute } from "./generate/dashboard-title.ts";
import { enhancePromptRoute } from "./generate/enhance-prompt.ts";
import { widgetInfoFileRoute, widgetInfoRoute } from "./generate/widget-info.ts";
import { queryRoute } from "./query.ts";
import { statusRoute } from "./status.ts";
import { transcribeRoute } from "./transcribe.ts";

/** Every route that the agent serves, in the order that the reference lists them. */
export const ROUTE_DEFINITIONS: RouteDefinition[] = [
  agentsRootRoute,
  agentsDescriptorRoute,
  statusRoute,
  readyRoute,
  queryRoute,
  chatTitleRoute,
  dashboardTitleRoute,
  enhancePromptRoute,
  widgetInfoRoute,
  widgetInfoFileRoute,
  codeRoute,
  transcribeRoute,
];

export const ROUTE_TAGS: TagDescription[] = [
  { name: "service", description: "The routes that tell whether the agent runs and what it can do." },
  { name: "query", description: "The route that asks the agent a question." },
  { name: "generate", description: "The helper routes, which make one call to the model and never run tools." },
  { name: "speech", description: "The route that turns a recording into text." },
];
