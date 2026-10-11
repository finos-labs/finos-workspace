import { Hono } from "hono";
import { configuredModels } from "../lib/config";
import { getLogger } from "../lib/logger";

const logger = getLogger(["app", "routes", "agents"]);

/** The id the Workspace knows this agent by, and the one its role grants of models are filed under. */
export const AGENT_ID = "default_agent";

export const agentsRouter = new Hono();

agentsRouter.get("/", (c) => {
  return c.text("Ines");
});

agentsRouter.get("/agents.json", (c) => {
  logger.debug("Agent descriptor requested");

  // The models this agent is configured with (DEFAULT_MODEL and INES_MODELS); with none, no picker is offered.
  const models = configuredModels();
  const defaultModel = process.env.DEFAULT_MODEL || models[0];

  return c.json({
    [AGENT_ID]: {
      name: "Ines",
      description:
        "An open-source, model-agnostic agent for the Workspace",
      endpoints: { query: "/v1/query" },
      features: {
        streaming: true,
        "widget-dashboard-select": true,
        "widget-dashboard-search": true,
        "widget-global-search": true,
        "mcp-tools": true,
        "generative-ui": true,
        "file-upload": true,
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
