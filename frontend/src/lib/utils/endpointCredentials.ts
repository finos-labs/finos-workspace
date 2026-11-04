import type { WidgetT } from "~/components/types";

export function withoutEndpointCredentials<W extends Pick<WidgetT, "endpoint">>(
  widget: W,
): W {
  if (!widget.endpoint) return widget;
  const { url, method } = widget.endpoint;
  return { ...widget, endpoint: { url, method } };
}
