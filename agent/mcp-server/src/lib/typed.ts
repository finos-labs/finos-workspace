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
    text: JSON.stringify({ $agent_kind: "artifact", artifact }),
  };
}

export function webCitationItem(args: { url: string; title: string; id?: string }): ContentItem {
  return {
    type: "text",
    text: JSON.stringify({
      $agent_kind: "citation",
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
  score?: number;
  id?: string;
}): ContentItem {
  return {
    type: "text",
    text: JSON.stringify({
      $agent_kind: "citation",
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
    text: JSON.stringify({ $agent_kind: "sqlite_table", name, rows }),
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
      $agent_kind: "error",
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
    text: JSON.stringify({ $agent_kind: "model_context", summary }),
  };
}
