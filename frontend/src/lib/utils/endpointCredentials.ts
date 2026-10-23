import type { WidgetT } from "~/components/types";

export type EndpointHeaderRows = WidgetT["endpointHeaders"] | null | undefined;

export function splitEndpointHeaders(rows: EndpointHeaderRows) {
  const headers: Record<string, string> = {};
  const query: Record<string, string> = {};
  for (const { key, value, location = "headers" } of rows ?? []) {
    if (location === "query") query[key] = value;
    else headers[key] = value;
  }
  return { headers, query };
}

export function withoutEndpointCredentials<W extends Pick<WidgetT, "endpoint">>(
  widget: W,
): W {
  if (!widget.endpoint) return widget;
  const { url, method } = widget.endpoint;
  return { ...widget, endpoint: { url, method } };
}
