import { getLogger, withContext } from "@logtape/logtape";
import { honoLogger as createHonoLogger } from "@logtape/hono";
import { configureLogging } from "../../../src/lib/logging.ts";

await configureLogging("mcp");

export { getLogger, withContext };
export const honoLogger = createHonoLogger({ category: ["hono"] });
