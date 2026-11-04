import { AsyncLocalStorage } from "node:async_hooks";
import {
  configure,
  getConsoleSink,
  jsonLinesFormatter,
  type LogLevel,
  type Sink,
} from "@logtape/logtape";
import { LOG_FORMATS, LOG_LEVELS } from "./env-reference.ts";
import { redactRecord } from "./redact.ts";

function isProduction(env: Record<string, string | undefined>): boolean {
  return env.NODE_ENV === "production";
}

export function parseLogLevel(env: Record<string, string | undefined> = process.env): LogLevel {
  const raw = (env.LOG_LEVEL ?? (isProduction(env) ? "info" : "debug")).toLowerCase();
  const level = raw === "warn" ? "warning" : raw;
  if (!(LOG_LEVELS as readonly string[]).includes(level)) {
    throw new Error(`LOG_LEVEL must be one of ${LOG_LEVELS.join(", ")}; got "${env.LOG_LEVEL}".`);
  }
  return level as LogLevel;
}

export function parseLogFormat(
  env: Record<string, string | undefined> = process.env,
): "json" | "pretty" {
  const raw = (env.LOG_FORMAT ?? (isProduction(env) ? "json" : "pretty")).toLowerCase();
  if (!(LOG_FORMATS as readonly string[]).includes(raw)) {
    throw new Error(`LOG_FORMAT must be ${LOG_FORMATS.join(" or ")}; got "${env.LOG_FORMAT}".`);
  }
  return raw as (typeof LOG_FORMATS)[number];
}

export function redactingSink(next: Sink): Sink {
  return (record) => next(redactRecord(record));
}

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
        { category: ["audit"], sinks: ["console"], lowestLevel: "info" },
      ],
    });
  } catch {
  }
}
