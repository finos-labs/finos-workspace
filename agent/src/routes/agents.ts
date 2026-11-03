import { Hono } from "hono";
import { z } from "zod";
import { configuredModels } from "../lib/config.ts";
import { getLogger } from "../lib/logger.ts";
import { defineRoute, named } from "../lib/openapi.ts";
import { transcribeModel } from "../lib/transcribe.ts";
import { agentSkills } from "../skills/index.ts";

const logger = getLogger(["app", "routes", "agents"]);

export const AGENT_ID = "default_agent";

const AgentDescriptorSchema = z.object({
  name: z.string().describe("The name of the agent, which the interface shows."),
  description: z.string().describe("What the agent does."),
  endpoints: z
    .object({ query: z.string().describe("The route that asks the agent a question.") })
    .describe("The routes that the agent serves."),
  skills: z.array(z.unknown()).describe("The skills that the agent offers."),
  features: z
    .record(z.string(), z.unknown())
    .describe("The features that this deployment offers, such as streaming, the MCP tools or speech to text."),
});

export const agentsRootRoute = defineRoute({
  method: "GET",
  path: "/",
  tag: "service",
  summary: "Answers with the text Agent.",
  description: "Answers with the plain text Agent. It tells a person who opens the address of the agent that the agent is running.",
  responses: [{ code: "200", description: "The text Agent.", contentType: "text/plain" }],
  secured: false,
});

export const agentsDescriptorRoute = defineRoute({
  method: "GET",
  path: "/agents.json",
  tag: "service",
  summary: "The agent's descriptor, which the Workspace reads to learn the agent's name, skills and features.",
  description:
    "Answers the descriptor of the agent: its name, what it does, the route that asks it a question, its skills and the features that this deployment offers. The FINOS Workspace reads the descriptor to show the agent in the interface and to know what it can do.",
  responses: [
    {
      code: "200",
      description: "The descriptor of the agent, under its id.",
      schema: named(
        "AgentsDescriptor",
        z.record(z.string(), AgentDescriptorSchema).describe("The agents that this service offers, each under its id."),
        "output",
      ),
    },
  ],
  secured: false,
});

export const agentsRouter = new Hono();

agentsRouter.get(agentsRootRoute.path, (c) => {
  return c.text("Agent");
});

agentsRouter.get(agentsDescriptorRoute.path, (c) => {
  logger.debug("Agent descriptor requested");

  const models = configuredModels();
  const defaultModel = process.env.DEFAULT_MODEL || models[0];

  return c.json({
    [AGENT_ID]: {
      name: "Agent",
      description:
        "An open-source, model-agnostic agent for the FINOS Workspace",
      endpoints: { query: "/v1/query" },
      skills: agentSkills(),
      features: {
        streaming: true,
        "widget-dashboard-select": true,
        "widget-dashboard-search": true,
        "widget-global-search": true,
        "mcp-tools": true,
        "file-upload": true,
        ...(transcribeModel() ? { "speech-to-text": true } : {}),
        "prompt-suggestions": {
          label: "Follow-up Suggestions",
          default: true,
          description: "Show follow-up prompt suggestions after each response.",
        },
        ...(defaultModel
          ? {
              model: {
                label: "Model",
                type: "select",
                default: defaultModel,
                description: "Select the LLM model to use.",
                options: models.map((model) => ({ label: model, value: model })),
              },
            }
          : {}),
      },
    },
  });
});
