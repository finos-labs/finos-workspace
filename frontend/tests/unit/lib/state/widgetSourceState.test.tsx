import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BackendPermissionsT } from "~/api/user_roles.api";
import type { WidgetT } from "~/components/types";
import { useWidgetContext } from "~/components/Widget.context";
import { useJsonData } from "~/lib/api";
import {
  getSourceCredentials,
  getWidgetSourceState,
  type Source,
  useBackendConnectorStore,
} from "~/lib/state/backendConnector";
import { usePermissionsStore } from "~/lib/state/permissions";
import { plainRequest } from "~/lib/utils/widgetRequest";
import { HttpResponse, http, server, setupMSW } from "../../../mocks/msw-utils";
import { partial } from "../../mocks";

vi.mock("~/components/Widget.context", () => ({ useWidgetContext: vi.fn() }));

const OWN_SOURCE = partial<Source>({
  id: "own-backend",
  name: "Mine",
  url: "https://data.example.test",
  endpointHeaders: [{ key: "X-Api-Key", value: "own-key", location: "headers" }],
});

const ROLE_SHARED = partial<BackendPermissionsT>({
  uuid: "role-backend",
  name: "Team data",
  access: "access",
  url: "https://team.example.test",
  endpointHeaders: [{ key: "X-Api-Key", value: "team-key", location: "headers" }],
  widgets: [],
  templates: [],
});

const widget = (overrides: Partial<WidgetT>) =>
  partial<WidgetT>({ connectionType: "advanced-backend", ...overrides });

function loadSources(sources: Source[]) {
  useBackendConnectorStore.setState({ apiSources: sources, sourcesLoaded: true });
}

afterEach(() => {
  useBackendConnectorStore.setState({ apiSources: [], sourcesLoaded: false });
  usePermissionsStore.setState({
    permissions: { backends: [], files: [], prompts: [] },
  });
});

describe("whether a widget can fetch from its data backend", () => {
  it("has no data backend to check without a source, or for a file", () => {
    expect(getWidgetSourceState(widget({ sourceId: undefined }))).toBe("none");
    expect(
      getWidgetSourceState(widget({ sourceId: "file-1", connectionType: "file" })),
    ).toBe("none");
  });

  it("waits until the user's backends are loaded", () => {
    expect(getWidgetSourceState(widget({ sourceId: "own-backend" }))).toBe("pending");
  });

  it("fetches from the user's own backend and from one a role shares", () => {
    loadSources([OWN_SOURCE]);
    usePermissionsStore.setState({
      permissions: { backends: [ROLE_SHARED], files: [], prompts: [] },
    });

    expect(getWidgetSourceState(widget({ sourceId: "own-backend" }))).toBe("available");
    expect(getWidgetSourceState(widget({ sourceId: "role-backend" }))).toBe(
      "available",
    );
    expect(
      getSourceCredentials("role-backend", "https://team.example.test/prices").headers,
    ).toEqual({ "X-Api-Key": "team-key" });
    expect(
      getSourceCredentials("own-backend", "https://data.example.test/prices").headers,
    ).toEqual({ "X-Api-Key": "own-key" });
  });

  it("refuses a backend that is someone else's", () => {
    loadSources([OWN_SOURCE]);
    usePermissionsStore.setState({
      permissions: {
        backends: [{ ...ROLE_SHARED, access: "no-access" }],
        files: [],
        prompts: [],
      },
    });

    expect(getWidgetSourceState(widget({ sourceId: "owners-backend" }))).toBe(
      "unavailable",
    );
    expect(getWidgetSourceState(widget({ sourceId: "role-backend" }))).toBe(
      "unavailable",
    );
  });
});

describe("useJsonData and the widget's data backend", () => {
  setupMSW();

  function createWrapper() {
    const queryClient = new QueryClient();
    return ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  function renderWidgetFetch(sourceId: string) {
    vi.mocked(useWidgetContext).mockReturnValue(
      partial({ widget: widget({ id: "w1", sourceId }), activeDashboardId: "d1" }),
    );
    return renderHook(
      () =>
        useJsonData(
          { request: plainRequest("https://data.example.test/prices", undefined) },
          { retry: false },
        ),
      { wrapper: createWrapper() },
    );
  }

  it("never calls a backend that is not the viewer's", async () => {
    const seen: string[] = [];
    server.use(
      http.get("https://data.example.test/prices", ({ request }) => {
        seen.push(request.url);
        return HttpResponse.json({ ok: true });
      }),
    );
    loadSources([OWN_SOURCE]);

    const { result } = renderWidgetFetch("owners-backend");

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result.current.fetchStatus).toBe("idle");
    expect(seen).toEqual([]);
  });

  it("calls the viewer's own backend once their backends are loaded", async () => {
    const seen: string[] = [];
    server.use(
      http.get("https://data.example.test/prices", ({ request }) => {
        seen.push(request.url);
        return HttpResponse.json({ ok: true });
      }),
    );

    const { result } = renderWidgetFetch("own-backend");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(seen).toEqual([]);

    loadSources([OWN_SOURCE]);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seen).toEqual(["https://data.example.test/prices"]);
  });
});
