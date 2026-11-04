import type { Mock } from "vitest";

const SOURCE_ROUTE = "/app/data-connectors/api-source";

export type ProxiedInit = RequestInit & {
  proxy?: { route: "saved" | "candidate"; sourceId?: string; typedHeaders?: unknown[] };
};

export function throughSourceProxy(mock: Mock): typeof fetch {
  return ((url: string | URL, init?: RequestInit) => {
    const target = String(url);
    if (!target.includes(SOURCE_ROUTE)) return mock(url, init);
    const body = JSON.parse(String(init?.body));
    const candidate = target.includes("/api-source-test/");
    const call = candidate ? body.request : body;
    const forwarded: ProxiedInit = {
      method: call.method ?? "GET",
      headers: call.headers ?? {},
      ...(call.body === undefined ? {} : { body: call.body }),
      proxy: candidate
        ? { route: "candidate", sourceId: body.id, typedHeaders: body.endpointHeaders }
        : { route: "saved", sourceId: target.split("/api-source/")[1]?.split("/")[0] },
    };
    return mock(call.url, forwarded);
  }) as typeof fetch;
}
