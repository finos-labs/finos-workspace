/**
 * Logging for the agent and the MCP server, which share it.
 *
 *   LOG_LEVEL   trace | debug | info | warning | error | fatal. Default: info in production, debug otherwise.
 *   LOG_FORMAT  json | pretty. Default: json in production, pretty otherwise.
 *
 * Every record goes through `redactRecord` before it is written. Properties that
 * `withContext` sets (request id, conversation, user) are added to every record logged inside it.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import {
  configure,
  getConsoleSink,
  jsonLinesFormatter,
  type LogLevel,
  type Sink,
} from "@logtape/logtape";
import { redactRecord } from "./redact.ts";

const LEVELS: readonly LogLevel[] = ["trace", "debug", "info", "warning", "error", "fatal"];

function isProduction(env: Record<string, string | undefined>): boolean {
  return env.NODE_ENV === "production";
}

export function parseLogLevel(env: Record<string, string | undefined> = process.env): LogLevel {
  const raw = (env.LOG_LEVEL ?? (isProduction(env) ? "info" : "debug")).toLowerCase();
  const level = raw === "warn" ? "warning" : raw;
  if (!(LEVELS as readonly string[]).includes(level)) {
    throw new Error(`LOG_LEVEL must be one of ${LEVELS.join(", ")}; got "${env.LOG_LEVEL}".`);
  }
  return level as LogLevel;
}

export function parseLogFormat(
  env: Record<string, string | undefined> = process.env,
): "json" | "pretty" {
  const raw = (env.LOG_FORMAT ?? (isProduction(env) ? "json" : "pretty")).toLowerCase();
  if (raw !== "json" && raw !== "pretty") {
    throw new Error(`LOG_FORMAT must be json or pretty; got "${env.LOG_FORMAT}".`);
  }
  return raw;
}

/** A sink that redacts each record before handing it on. */
export function redactingSink(next: Sink): Sink {
  return (record) => next(redactRecord(record));
}

/**
 * Sets up LogTape for one process. `root` is the category its own loggers live under ("app" for the
 * agent, "mcp" for the tools). Idempotent: LogTape refuses a second configuration, and the first wins.
 */
export async function configureLogging(
  root: string,
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const level = parseLogLevel(env);
  const format = parseLogFormat(env);
  const consoleSink = getConsoleSink(format === "json" ? { formatter: jsonLinesFormatter } : undefined);
  try {
    await configure({
      contextLocalStorage: new AsyncLocalStorage(),
      sinks: { console: redactingSink(consoleSink) },
      loggers: [
        { category: ["logtape", "meta"], lowestLevel: "warning" },
        { category: [root], sinks: ["console"], lowestLevel: level },
        { category: ["hono"], sinks: ["console"], lowestLevel: level },
        // Who did what: one line per query and per refusal. Kept at info whatever LOG_LEVEL says.
        { category: ["audit"], sinks: ["console"], lowestLevel: "info" },
      ],
    });
  } catch {
    // Already configured by another module load — fine.
  }
}
