import type { WidgetT } from "~/components/types";

/** A data backend's credentials, as the API sends them with the source. */
export type EndpointHeaderRows = WidgetT["endpointHeaders"] | null | undefined;

/** A data backend's credentials split by where a request carries them. */
export function splitEndpointHeaders(rows: EndpointHeaderRows) {
  const headers: Record<string, string> = {};
  const query: Record<string, string> = {};
  for (const { key, value, location = "headers" } of rows ?? []) {
    if (location === "query") query[key] = value;
    else headers[key] = value;
  }
  return { headers, query };
}

/**
 * A widget as a dashboard or an app saves it: the endpoint keeps its URL and method and
 * never a data backend's credentials. Widgets look those up in the in-memory source when
 * they fetch.
 */
export function withoutEndpointCredentials<W extends Pick<WidgetT, "endpoint">>(
  widget: W,
): W {
  if (!widget.endpoint) return widget;
  const { url, method } = widget.endpoint;
  return { ...widget, endpoint: { url, method } };
}
