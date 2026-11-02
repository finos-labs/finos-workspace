import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../../auth/middleware.ts";
import { truncate } from "../../lib/llm.ts";
import { getLogger } from "../../lib/logger.ts";
import {
  bodyTooLarge,
  defineRoute,
  invalidRequest,
  named,
  tooManyRequests,
  unauthorized,
} from "../../lib/openapi.ts";
import { helperLlm, invalidJson, modelField, readJson } from "./helper.ts";

const logger = getLogger(["app", "generate", "dashboard-title"]);

export const DASHBOARD_TITLE_WIDGETS = 20;
export const DASHBOARD_TITLE_NAME_CHARS = 100;
export const DASHBOARD_TITLE_FALLBACK = "My Dashboard";

export const DashboardTitleSchema = z.object({
  widgets: z
    .array(
      z.object({
        uuid: z.string().optional().describe("Accepted and not used."),
        name: z.string().optional().describe("The widget's name, which the title is made from."),
        description: z.string().optional().describe("Accepted and not used."),
        metadata: z.unknown().optional().describe("Accepted and not used."),
      }),
    )
    .min(1)
    .max(1000)
    .describe("The widgets of the dashboard."),
  model: modelField,
});

export const dashboardTitleRoute = defineRoute({
  method: "POST",
  path: "/v1/generate/dashboard/title",
  tag: "generate",
  summary: "Names a dashboard.",
  description: "Names the dashboard that the widgets belong to. The agent makes one call to the model and never runs tools.",
  request: { contentType: "application/json", required: true, schema: named("DashboardTitleRequest", DashboardTitleSchema) },
  responses: [
    { code: "200", description: "The title of the dashboard, as plain text.", contentType: "text/plain" },
    invalidRequest(),
    unauthorized(),
    bodyTooLarge(),
    tooManyRequests(),
  ],
  secured: true,
  helper: {
    detail: `The agent reads the first ${DASHBOARD_TITLE_WIDGETS} widget names, each cut to ${DASHBOARD_TITLE_NAME_CHARS} characters.`,
    answer: "Plain text, the title.",
    fallback: `${DASHBOARD_TITLE_FALLBACK}, also when no widget has a name.`,
  },
});

export const dashboardTitleRouter = new Hono<AppEnv>();

dashboardTitleRouter.post(dashboardTitleRoute.path, async (c) => {
  const raw = await readJson(c);
  if (raw === null) return invalidJson(c);
  const parsed = DashboardTitleSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
  }

  const { widgets, model } = parsed.data;
  const names = widgets.map((w) => w.name).filter((n): n is string => Boolean(n)).slice(0, DASHBOARD_TITLE_WIDGETS).map((n) => truncate(n, DASHBOARD_TITLE_NAME_CHARS));

  if (names.length === 0) return c.text(DASHBOARD_TITLE_FALLBACK);

  const prompt =
    "Generate a short dashboard name (2-5 words) based on these widgets. " +
    "Return ONLY the name, no quotes, no JSON.\n\n" +
    `Widgets: ${names.join(", ")}`;

  try {
    const title = await helperLlm(c, prompt, { model, functionId: "generate.dashboard-title" });
    const cleaned = title.replace(/^["']|["']$/g, "");
    logger.info("dashboard/title generated", { title: cleaned });
    return c.text(cleaned);
  } catch (err) {
    logger.warn("dashboard/title failed", { error: err instanceof Error ? err.message : String(err) });
    return c.text(DASHBOARD_TITLE_FALLBACK);
  }
});
