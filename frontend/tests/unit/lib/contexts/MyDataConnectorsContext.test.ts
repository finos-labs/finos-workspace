import { describe, expect, it } from "vitest";
import { createAllElements } from "~/lib/contexts/MyDataConnectorsContext";
import type { Source } from "~/lib/state/backendConnector";

const source = (fields: Partial<Source>): Source => ({
  endpointHeaders: null,
  id: "source",
  name: "Source",
  url: "https://example.com",
  widgets: {},
  ...fields,
});

const apiSources = [
  source({ id: "a", uuid: "a", name: "Answering", status: "success" }),
  source({ id: "b", uuid: "b", name: "Silent", status: "error" }),
  source({
    id: "c",
    uuid: "c",
    name: "Organization",
    status: "error",
    isEntityBackend: true,
  }),
];

const backendNames = (elements: ReturnType<typeof createAllElements>) =>
  elements
    .find((element) => element.type === "backend")
    ?.items.map((item) => item.name);

describe("createAllElements", () => {
  it("lists the backends that answer", () => {
    expect(backendNames(createAllElements({ storedFiles: [], apiSources }))).toEqual([
      "Answering",
    ]);
  });

  it("lists an organization backend that does not answer when asked to", () => {
    expect(
      backendNames(
        createAllElements({
          storedFiles: [],
          apiSources,
          includeOrganizationBackends: true,
        }),
      ),
    ).toEqual(["Answering", "Organization"]);
  });
});
