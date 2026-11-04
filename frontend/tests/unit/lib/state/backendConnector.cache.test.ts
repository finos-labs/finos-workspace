import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Source, useBackendConnectorStore } from "~/lib/state/backendConnector";
import { throughSourceProxy } from "../../../mocks/sourceProxy";
import { installWidgetsSchemaFixture } from "../../../mocks/widgetsSchema";

const mockFetch = vi.fn();
global.fetch = throughSourceProxy(mockFetch);
installWidgetsSchemaFixture();

const WIDGETS = {
  prices: {
    name: "Prices",
    description: "Prices",
    type: "markdown",
    endpoint: "/prices",
    params: [],
  },
};

const answer = (url: string) => {
  const name = url.split("/").at(-1);
  if (name === "widgets.json")
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(WIDGETS),
      headers: new Headers(),
    });
  return Promise.resolve({
    ok: false,
    status: 404,
    json: () => Promise.resolve([]),
    headers: new Headers(),
  });
};

const source = (id: string, updatedDate = "2026-10-29T00:00:00Z"): Source => ({
  id,
  uuid: id,
  name: `Backend ${id}`,
  url: `https://${id}.example.test`,
  endpointHeaders: [{ key: "X-Api-Key", value: "", location: "headers" }],
  updatedDate,
});

const widgetsRequested = () =>
  mockFetch.mock.calls.filter(([url]) => String(url).endsWith("/widgets.json")).length;

describe("a connection that was checked recently", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockImplementation((url: string) => answer(String(url)));
    useBackendConnectorStore.setState({ apiSources: [], sourcesLoaded: false });
  });

  it("is not asked for its files again when the list is loaded again", async () => {
    const { updateApiSources } = useBackendConnectorStore.getState();
    await updateApiSources([source("a"), source("b")]);
    expect(widgetsRequested()).toBe(2);
    expect(useBackendConnectorStore.getState().apiSources.map((s) => s.status)).toEqual(
      ["success", "success"],
    );

    await updateApiSources([source("a"), source("b")]);
    expect(widgetsRequested()).toBe(2);
    const [a] = useBackendConnectorStore.getState().apiSources;
    expect(a.status).toBe("success");
    expect(Object.keys(a.widgets ?? {})).toEqual(["prices"]);
    expect(useBackendConnectorStore.getState().isLoadingBackends).toBe(false);
  });

  it("is checked again when it changed, and only that one", async () => {
    const { updateApiSources } = useBackendConnectorStore.getState();
    await updateApiSources([source("a"), source("b")]);
    await updateApiSources([source("a"), source("b", "2026-10-30T00:00:00Z")]);
    expect(widgetsRequested()).toBe(3);
    expect(useBackendConnectorStore.getState().apiSources.map((s) => s.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("is checked again after thirty minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const { updateApiSources } = useBackendConnectorStore.getState();
      await updateApiSources([source("a")]);
      vi.setSystemTime(Date.now() + 29 * 60 * 1000);
      await updateApiSources([source("a")]);
      expect(widgetsRequested()).toBe(1);
      vi.setSystemTime(Date.now() + 2 * 60 * 1000);
      await updateApiSources([source("a")]);
      expect(widgetsRequested()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("is checked again when the user refreshes", async () => {
    const { updateApiSources, forgetValidation } = useBackendConnectorStore.getState();
    await updateApiSources([source("a")]);
    forgetValidation();
    await updateApiSources([source("a")]);
    expect(widgetsRequested()).toBe(2);
  });

  it("is checked again when it failed, so that a dead backend is noticed coming back", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
        headers: new Headers(),
      }),
    );
    const { updateApiSources } = useBackendConnectorStore.getState();
    await updateApiSources([source("a")]);
    await updateApiSources([source("a")]);
    expect(widgetsRequested()).toBe(2);
    expect(useBackendConnectorStore.getState().apiSources[0].status).toBe("error");
  });
});
