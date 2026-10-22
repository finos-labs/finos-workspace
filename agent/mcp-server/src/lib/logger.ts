/**
 * LogTape setup for the ines-tools MCP server. Mirrors src/lib/logger.ts on
 * the agent side (the setup itself is shared: LOG_LEVEL, LOG_FORMAT and redaction
 * live in src/lib/logging.ts) so logs across both processes share the same shape
 * and can be grep'd by conversationId for end-to-end traces.
 *
 * Category root is `mcp` (vs agent's `app`) so logs can be told apart.
 */

import { getLogger, withContext } from "@logtape/logtape";
import { honoLogger as createHonoLogger } from "@logtape/hono";
import { configureLogging } from "../../../src/lib/logging.ts";

await configureLogging("mcp");

export { getLogger, withContext };
export const honoLogger = createHonoLogger({ category: ["hono"] });
