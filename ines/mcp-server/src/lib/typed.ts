/**
 * Typed-result helpers for the ines MCP server.
 *
 * The agent's `src/mcp/results.ts` parses each MCP text content item; if it parses as JSON
 * with `$ines_kind`, it dispatches as artifact / citation / sqlite_table. Otherwise the text
 * is injected into the model's context as plain text.
 *
 * Each helper returns a single MCP `{ type: "text", text: <json> }` content item.
 */

export interface ContentItem {
  type: "text";
  text: string;
}

export function textItem(content: string): ContentItem {
  return { type: "text", text: content };
}

export function artifactItem(artifact: Record<string, unknown>): ContentItem {
  return {
    type: "text",
    text: JSON.stringify({ $ines_kind: "artifact", artifact }),
  };
}

export function webCitationItem(args: { url: string; title: string; id?: string }): ContentItem {
  return {
    type: "text",
    text: JSON.stringify({
      $ines_kind: "citation",
      citation: {
        type: "web",
        url: args.url,
        title: args.title,
        ...(args.id ? { id: args.id } : {}),
      },
    }),
  };
}

export function documentCitationItem(args: {
  uri: string;
  title: string;
  page?: number;
  /** How well the passage matched the question (cosine similarity); lets the agent tell the pages that matter from the rest. */
  score?: number;
  id?: string;
}): ContentItem {
  return {
    type: "text",
    text: JSON.stringify({
      $ines_kind: "citation",
      citation: {
        type: "document",
        uri: args.uri,
        title: args.title,
        ...(args.page != null ? { page: args.page } : {}),
        ...(args.score != null ? { score: args.score } : {}),
        ...(args.id ? { id: args.id } : {}),
      },
    }),
  };
}

export function sqliteTableItem(name: string, rows: Record<string, unknown>[]): ContentItem {
  return {
    type: "text",
    text: JSON.stringify({ $ines_kind: "sqlite_table", name, rows }),
  };
}

export function errorItem(args: {
  code: string;
  message: string;
  retryable?: boolean;
}): ContentItem {
  return {
    type: "text",
    text: JSON.stringify({
      $ines_kind: "error",
      error: {
        code: args.code,
        message: args.message,
        retryable: args.retryable ?? false,
      },
    }),
  };
}

export function modelContextItem(summary: string): ContentItem {
  return {
    type: "text",
    text: JSON.stringify({ $ines_kind: "model_context", summary }),
  };
}
