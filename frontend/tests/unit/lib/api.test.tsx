import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { describe, expect, it } from "vitest";
import { fetchBackend, useJsonData } from "~/lib/api";
import { type BuiltRequest, plainRequest } from "~/lib/utils/widgetRequest";
import { HttpResponse, http, server, setupMSW } from "../../mocks/msw-utils";
import "../../mocks/runtimeConfig";

const BACKEND_URL = "http://localhost:3000";
const CSV_BODY = "a,b\n1,2";

type Seen = { client: string | null; credentials: string | null; auth: string | null };

function apiHandler(url: string, seen: Seen[]) {
  return http.all(url, ({ request }) => {
    seen.push({
      client: request.headers.get("X-Workspace-Client"),
      credentials: request.credentials,
      auth: request.headers.get("Authorization"),
    });
    if (request.headers.get("X-Workspace-Client") !== "web") {
      return HttpResponse.json({ detail: "Not authenticated" }, { status: 401 });
    }
    return HttpResponse.text(CSV_BODY);
  });
}

function createWrapper() {
  const queryClient = new QueryClient();
  return ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useJsonData and the Workspace session", () => {
  setupMSW();

  it("sends the session cookie and the client header with a GET of the API's files", async () => {
    const seen: Seen[] = [];
    server.use(apiHandler(`${BACKEND_URL}/app/files/:fileName`, seen));

    const { result } = renderHook(
      () =>
        useJsonData(
          {
            request: plainRequest(`${BACKEND_URL}/app/files/some-file.csv`, undefined),
            asText: true,
          },
          { retry: false },
        ),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(CSV_BODY);
    expect(seen).toEqual([{ client: "web", credentials: "include", auth: null }]);
  });

  it("sends no Workspace credential to other hosts", async () => {
    const seen: Seen[] = [];
    server.use(
      http.get("https://example.com/data", ({ request }) => {
        seen.push({
          client: request.headers.get("X-Workspace-Client"),
          credentials: request.credentials,
          auth: request.headers.get("Authorization"),
        });
        return HttpResponse.json({ ok: true });
      }),
    );

    const { result } = renderHook(
      () =>
        useJsonData(
          { request: plainRequest("https://example.com/data", undefined) },
          { retry: false },
        ),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seen).toEqual([{ client: null, credentials: "omit", auth: null }]);
  });

  it("sends no Workspace credential to a host that only contains the API's URL", async () => {
    const seen: Seen[] = [];
    server.use(
      http.get("https://example.com/data", ({ request }) => {
        seen.push({
          client: request.headers.get("X-Workspace-Client"),
          credentials: request.credentials,
          auth: request.headers.get("Authorization"),
        });
        return HttpResponse.json({ ok: true });
      }),
    );

    const { result } = renderHook(
      () =>
        useJsonData(
          {
            request: plainRequest(
              "https://example.com/data?next=http://localhost:3000/app",
              undefined,
            ),
          },
          { retry: false },
        ),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seen).toEqual([{ client: null, credentials: "omit", auth: null }]);
  });

  it.each([
    ["GET", `${BACKEND_URL}/app/dash/validate-and-sync`],
    ["POST", `${BACKEND_URL}/app/logout`],
    ["POST", `${BACKEND_URL}/app/files/some-file.csv`],
  ] as const)("never sends the session with a widget's %s to %s", async (method, url) => {
    const seen: Seen[] = [];
    server.use(apiHandler(url, seen));

    const request: BuiltRequest = {
      ok: true,
      request: { url, method, credentials: {}, paramHeaders: {} },
    };
    const { result } = renderHook(() => useJsonData({ request }, { retry: false }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(seen).toEqual([{ client: null, credentials: "omit", auth: null }]);
  });
});

describe("fetchBackend", () => {
  setupMSW();

  it("calls the API with the session cookie and the client header", async () => {
    const seen: Seen[] = [];
    server.use(apiHandler(`${BACKEND_URL}/app/mcp-proxy`, seen));

    const response = await fetchBackend(`${BACKEND_URL}/app/mcp-proxy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    expect(response.status).toBe(200);
    expect(seen).toEqual([{ client: "web", credentials: "include", auth: null }]);
  });

  it.each([
    "https://example.com/app/mcp-proxy",
    "http://localhost:3000.evil.test/app/mcp-proxy",
  ])("refuses to call anything but the API: %s", async (url) => {
    const seen: Seen[] = [];
    server.use(apiHandler(url, seen));

    await expect(fetchBackend(url)).rejects.toThrow("only calls the Workspace API");
    expect(seen).toEqual([]);
  });
});
