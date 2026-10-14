import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { useJsonData } from "~/lib/api";
import { useAuthStore } from "~/lib/state/auth";
import { plainRequest } from "~/lib/utils/widgetRequest";
import { HttpResponse, http, server, setupMSW } from "../../mocks/msw-utils";
import "../../mocks/runtimeConfig";

// Matches mockConfig.urls.backend from tests/mocks/runtimeConfig
const BACKEND_URL = "http://localhost:3000";
const TEST_TOKEN = "test-token";
const CSV_BODY = "a,b\n1,2";

function fileHandler(origin: string) {
  return http.get(`${origin}/app/files/:fileName`, ({ request }) => {
    if (request.headers.get("Authorization") !== `Bearer ${TEST_TOKEN}`) {
      return HttpResponse.json(
        { detail: "Not authenticated", status: 401 },
        { status: 401 },
      );
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

describe("useJsonData bearer token on stored file URLs", () => {
  setupMSW();

  beforeEach(() => {
    useAuthStore.setState({ user: { token: TEST_TOKEN } } as never);
  });

  it("still authenticates URLs on the configured backend origin", async () => {
    server.use(fileHandler(BACKEND_URL));

    const { result } = renderHook(
      () =>
        useJsonData(
          {
            request: plainRequest(`${BACKEND_URL}/app/files/some-file.csv`),
            asText: true,
          },
          { retry: false },
        ),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(CSV_BODY);
  });

  it("does not send the token to external hosts", async () => {
    let authHeader: string | null = "unset";
    server.use(
      http.get("https://example.com/data", ({ request }) => {
        authHeader = request.headers.get("Authorization");
        return HttpResponse.json({ ok: true });
      }),
    );

    const { result } = renderHook(
      () =>
        useJsonData(
          { request: plainRequest("https://example.com/data") },
          { retry: false },
        ),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(authHeader).toBeNull();
  });
});
