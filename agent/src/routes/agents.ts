import { Hono } from "hono";
import { configuredModels } from "../lib/config.ts";
import { getLogger } from "../lib/logger.ts";
import { transcribeModel } from "../lib/transcribe.ts";
import { inesSkills } from "../skills/index.ts";

const logger = getLogger(["app", "routes", "agents"]);

/** The id the FINOS Workspace knows this agent by, and the one its role grants of models are filed under. */
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
        "An open-source, model-agnostic agent for the FINOS Workspace",
      endpoints: { query: "/v1/query" },
      // The skills that come with Ines: the FINOS Workspace shows them, and a user can pick one with /skill:<slug>.
      skills: inesSkills(),
      features: {
        streaming: true,
        "widget-dashboard-select": true,
        "widget-dashboard-search": true,
        "widget-global-search": true,
        "mcp-tools": true,
        "file-upload": true,
        // Dictation in the chat: the web app records and asks /v1/transcribe for the text.
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
