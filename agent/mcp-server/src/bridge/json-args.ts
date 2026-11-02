import { errorItem, type ContentItem } from "../lib/typed.ts";

export class JsonArgumentError extends Error {
  readonly command: string;
  readonly field: string;
  readonly reason: string;

  constructor(command: string, field: string, reason: string) {
    super(`${command} requires ${field} to ${reason}.`);
    this.name = "JsonArgumentError";
    this.command = command;
    this.field = field;
    this.reason = reason;
  }

  toContentItem(): ContentItem {
    return errorItem({
      code: "invalid_request",
      message: this.message,
      retryable: false,
    });
  }
}

export function parseJsonObject(
  command: string,
  field: string,
  raw: string | null | undefined,
): Record<string, unknown> {
  if (raw === null || raw === undefined) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new JsonArgumentError(command, field, `be valid JSON: ${msg}`);
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    throw new JsonArgumentError(command, field, "be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

export function parseJsonList(
  command: string,
  field: string,
  raw: string | null | undefined,
): Array<Record<string, unknown>> {
  if (raw === null || raw === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new JsonArgumentError(command, field, `be valid JSON: ${msg}`);
  }
  if (
    !Array.isArray(parsed) ||
    !parsed.every((item) => item !== null && typeof item === "object" && !Array.isArray(item))
  ) {
    throw new JsonArgumentError(command, field, "be a JSON array of objects");
  }
  return parsed as Array<Record<string, unknown>>;
}

function parseJsonValue(
  command: string,
  field: string,
  raw: string | null | undefined,
): unknown {
  if (raw === null || raw === undefined) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new JsonArgumentError(command, field, `be valid JSON: ${msg}`);
  }
}

export function parseGenerativeData(
  widgetType: string,
  raw: string | null | undefined,
): unknown {
  try {
    return parseJsonValue("add_generative_widget", "data_json", raw);
  } catch (err) {
    if (err instanceof JsonArgumentError) {
      if ((widgetType === "note" || widgetType === "html") && raw !== null && raw !== undefined) {
        return raw;
      }
    }
    throw err;
  }
}
