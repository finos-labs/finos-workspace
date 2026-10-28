import { getLogger, withContext } from "@logtape/logtape";
import { honoLogger as createHonoLogger } from "@logtape/hono";
import { configureLogging } from "./logging.ts";

await configureLogging("app");

export { getLogger, withContext };
export const honoLogger = createHonoLogger({ category: ["hono"] });
