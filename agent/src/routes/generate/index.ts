import { Hono } from "hono";
import type { AppEnv } from "../../auth/middleware";
import { chatTitleRouter } from "./chat-title";
import { enhancePromptRouter } from "./enhance-prompt";
import { dashboardTitleRouter } from "./dashboard-title";
import { widgetInfoRouter } from "./widget-info";
import { codeRouter } from "./code";

export const generateRouter = new Hono<AppEnv>();

generateRouter.route("/", chatTitleRouter);
generateRouter.route("/", enhancePromptRouter);
generateRouter.route("/", dashboardTitleRouter);
generateRouter.route("/", widgetInfoRouter);
generateRouter.route("/", codeRouter);
