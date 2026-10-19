import { getLogger, withContext } from "@logtape/logtape";
import { honoLogger as createHonoLogger } from "@logtape/hono";
import { configureLogging } from "./logging";

// LOG_LEVEL, LOG_FORMAT and redaction: see ./logging.ts. In tests, both this file and
// mcp-server/src/lib/logger.ts may be imported in the same process; the first configuration wins.
await configureLogging("app");

export { getLogger, withContext };
export const honoLogger = createHonoLogger({ category: ["hono"] });
