import get from "lodash/get";

export function rowsOf(response: unknown, rawDataKey?: string): unknown {
  if (rawDataKey) return get(response, rawDataKey, response);
  if (response && typeof response === "object" && "results" in response)
    return (response as { results?: unknown }).results ?? response;
  return response;
}
