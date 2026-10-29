import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { fetchCopilotAccess, putApiSourceMcpServers } from "~/api/auth.api";
import { type Source, useBackendConnectorStore } from "~/lib/state/backendConnector";
import {
  declaredMcpServers,
  reportDeclaredMcpServers,
} from "~/lib/state/backendMcpServers";
import { useCopilotAccessStore } from "~/lib/state/copilotAccess";

vi.mock("~/api/auth.api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/api/auth.api")>()),
  putApiSourceMcpServers: vi.fn(),
  fetchCopilotAccess: vi.fn(),
}));

const MAP_SERVER = "https://tunnel.example.com/mcp";
const DATA_SERVER = "https://data.example.com/mcp";

const backend = (overrides: Partial<Source> = {}) =>
  ({
    id: "source-1",
    name: "Hurricane",
    url: "https://hurricane.example.com",
    endpointHeaders: null,
    status: "success",
    widgets: {
      map: {
        name: "Map",
        type: "iframe",
        storage: { mcpUrl: "https://Tunnel.example.com/mcp/" },
      },
      table: { name: "Table", type: "table" },
      script: {
        name: "Script",
        type: "iframe",
        storage: { mcpUrl: "javascript:alert(1)" },
      },
      secret: {
        name: "Secret",
        type: "iframe",
        storage: { mcpUrl: "https://user:pass@secret.example.com/mcp" },
      },
    },
    templates: [
      {
        name: "App",
        mcpServers: [
          { name: "Data", url: DATA_SERVER },
          { name: "Same as the map", url: MAP_SERVER },
        ],
      },
    ],
    ...overrides,
  }) as unknown as Source;

describe("declaredMcpServers", () => {
  it("lists the iframe servers and the apps' servers once, normalized and sorted", () => {
    expect(declaredMcpServers(backend())).toEqual([DATA_SERVER, MAP_SERVER]);
  });

  it("is empty for a backend that declares none", () => {
    expect(declaredMcpServers(backend({ widgets: {}, templates: [] }))).toEqual([]);
  });
});

describe("reportDeclaredMcpServers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (putApiSourceMcpServers as Mock).mockResolvedValue({ status: 200 });
    (fetchCopilotAccess as Mock).mockResolvedValue({
      models: [],
      mcp: [{ server_url: MAP_SERVER, tool_name: "*" }],
    });
    useCopilotAccessStore.getState().setAccess(null);
  });

  it("reports what the backend declares, then refreshes the access", async () => {
    const source = backend({ id: "reports" });
    useBackendConnectorStore.setState({ apiSources: [source] });

    await reportDeclaredMcpServers(source);

    expect(putApiSourceMcpServers).toHaveBeenCalledWith("reports", [
      DATA_SERVER,
      MAP_SERVER,
    ]);
    expect(useBackendConnectorStore.getState().apiSources[0].mcpServers).toEqual([
      DATA_SERVER,
      MAP_SERVER,
    ]);
    expect(useCopilotAccessStore.getState().access?.mcp).toEqual([
      { server_url: MAP_SERVER, tool_name: "*" },
    ]);
  });

  it("reports nothing when the API already has the same servers", async () => {
    await reportDeclaredMcpServers(
      backend({ id: "known", mcpServers: [MAP_SERVER, DATA_SERVER] }),
    );

    expect(putApiSourceMcpServers).not.toHaveBeenCalled();
  });

  it("reports a change in the servers", async () => {
    const source = backend({ id: "changed", mcpServers: [DATA_SERVER] });
    useBackendConnectorStore.setState({ apiSources: [source] });

    await reportDeclaredMcpServers(source);

    expect(putApiSourceMcpServers).toHaveBeenCalledWith("changed", [
      DATA_SERVER,
      MAP_SERVER,
    ]);
  });

  it("waits for a backend that has not loaded", async () => {
    await reportDeclaredMcpServers(backend({ id: "pending", status: "pending" }));

    expect(putApiSourceMcpServers).not.toHaveBeenCalled();
  });

  it("leaves the access alone when the API refuses, and does not ask again", async () => {
    (putApiSourceMcpServers as Mock).mockResolvedValue({ status: 404 });
    const source = backend({ id: "shared" });
    useBackendConnectorStore.setState({ apiSources: [source] });

    await reportDeclaredMcpServers(source);
    await reportDeclaredMcpServers(source);

    expect(putApiSourceMcpServers).toHaveBeenCalledTimes(1);
    expect(fetchCopilotAccess).not.toHaveBeenCalled();
    expect(
      useBackendConnectorStore.getState().apiSources[0].mcpServers,
    ).toBeUndefined();
  });
});
