import { Hono } from "hono";
import type { AppEnv } from "../../auth/middleware.ts";
import { chatTitleRouter } from "./chat-title.ts";
import { enhancePromptRouter } from "./enhance-prompt.ts";
import { dashboardTitleRouter } from "./dashboard-title.ts";
import { widgetInfoRouter } from "./widget-info.ts";
import { codeRouter } from "./code.ts";

export const generateRouter = new Hono<AppEnv>();

generateRouter.route("/", chatTitleRouter);
generateRouter.route("/", enhancePromptRouter);
generateRouter.route("/", dashboardTitleRouter);
generateRouter.route("/", widgetInfoRouter);
generateRouter.route("/", codeRouter);
