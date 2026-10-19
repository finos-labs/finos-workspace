export type ParseAs =
  | "table"
  | "chart"
  | "text"
  | "html";

export function readParseAs(item: { data_format?: Record<string, unknown> }): ParseAs | null {
  const raw = item.data_format?.parse_as;
  if (typeof raw !== "string") return null;
  const v = raw.toLowerCase();
  switch (v) {
    case "table":
    case "chart":
    case "text":
    case "html":
      return v;
    default:
      return null;
  }
}

export interface ParseAsRoute {
  /** Load into SQLite as a structured table. */
  toSqlite: boolean;
  /** Inject content as raw text into model context. */
  asText: boolean;
  /** Show as a brief description placeholder rather than the full content. */
  brief: boolean;
}

export function routeForParseAs(parseAs: ParseAs | null): ParseAsRoute {
  switch (parseAs) {
    case "table":
    case "chart":
      return { toSqlite: true, asText: false, brief: false };
    case "text":
      return { toSqlite: false, asText: true, brief: false };
    case "html":
      return { toSqlite: false, asText: false, brief: true };
    case null:
      // Default: try SQLite for structured JSON arrays; fall through to text otherwise.
      return { toSqlite: true, asText: true, brief: false };
  }
}
