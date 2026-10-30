import { Hono } from "hono";
import { configuredModels } from "../lib/config.ts";
import { getLogger } from "../lib/logger.ts";
import { transcribeModel } from "../lib/transcribe.ts";
import { agentSkills } from "../skills/index.ts";

const logger = getLogger(["app", "routes", "agents"]);

export const AGENT_ID = "default_agent";

export const agentsRouter = new Hono();

agentsRouter.get("/", (c) => {
  return c.text("Agent");
});

agentsRouter.get("/agents.json", (c) => {
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
