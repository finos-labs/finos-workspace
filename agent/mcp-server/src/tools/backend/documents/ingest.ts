/**
 * Reading a document and cutting it into chunks, in a process of its own (see ingest-child.ts).
 */

import { IsolationError, runInChild } from "../../../../../src/lib/isolate.ts";
import { getLogger } from "../../../lib/logger.ts";
import type { IngestChildInput, IngestChildOutput } from "./ingest-child.ts";
import { INGEST_TIMEOUT_MS } from "./limits.ts";

const logger = getLogger(["mcp", "documents", "ingest"]);
const CHILD = new URL("./ingest-child.ts", import.meta.url).pathname;

export async function readAndChunkIsolated(input: IngestChildInput): Promise<IngestChildOutput> {
  try {
    return await runInChild<IngestChildInput, IngestChildOutput>(CHILD, input, {
      timeoutMs: INGEST_TIMEOUT_MS,
      label: "document read",
      logger,
    });
  } catch (error) {
    if (error instanceof IsolationError) {
      switch (error.kind) {
        case "timeout":
          throw new Error("it took too long to read and was stopped");
        case "busy":
          throw new Error("the server is busy reading other documents: try again in a moment");
        default:
          throw new Error("it could not be read");
      }
    }
    throw error;
  }
}
