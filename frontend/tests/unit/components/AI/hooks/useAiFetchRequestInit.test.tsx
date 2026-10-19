import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
  const allWidget = {
    uuid: "global-widget",
    widget_id: "global_widget",
    name: "Global Widget",
    description: "Global widget description",
    origin: "Sandbox",
    params: [],
  };
  const selectedCopilot = {
    id: "default-copilot",
    name: "Copilot",
    endpoints: { query: "https://ada.example/v1/query" },
    skills: [{ slug: "html-report", description: "HTML reports" }],
    features: {
      "widget-global-search": true,
      "mcp-tools": false,
      "agent-orchestration": false,
    },
  };

  return {
    allWidget,
    selectedCopilot,
    temporaryWidgets: [] as CopilotWidget[],
    customFeatureStates: {} as Record<string, boolean | string>,
  };
});

vi.mock("react-router-dom", () => ({ useParams: () => ({ id: "dashboard-1" }) }));
vi.mock("~/components/AI/hooks/useGetCopilotRequestHeaders", () => ({
  useGetCopilotRequestHeaders: () => () => ({
    "Content-Type": "application/json",
    "X-Trace-Id": "chat-1",
  }),
}));
vi.mock("~/components/AI/hooks/useGetFinalMessagesAndWidgets", () => ({
  useGetFinalMessagesAndWidgets: () => async () => ({
    finalMessages: [{ role: "human", content: "hello" }],
    finalDashboardWidgets: [],
    mentionWidgets: [],
  }),
}));
vi.mock("~/lib/constants", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  ALL_AI_FEATURES: new Set([
    "widget-global-search",
    "mcp-tools",
    "agent-orchestration",
  ]),
  getAiApiUrl: () => "https://ada.example",
  getDefaultCopilot: () => mockState.selectedCopilot,
  MAX_COPILOT_LINKS: 4,
}));
vi.mock("~/lib/state/copilot", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  useShallowCopilotStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      selectedCopilot: mockState.selectedCopilot,
      getCurrentChat: () => ({ id: "chat-1" }),
      getCurrentChatArtifacts: () => [],
      customFeatureStates: mockState.customFeatureStates,
      orchestrationModeEnabled: false,
    }),
}));
vi.mock("~/lib/state/copilotData", () => ({
  useShallowCopilotDataStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      widgetSubsetData: [],
      copilotWidgetsLastUpdated: 0,
      getCopilotWidgets: () => ({
        selectedWidgets: [],
        temporaryWidgets: mockState.temporaryWidgets,
        allWidgets: [mockState.allWidget],
        workspaceState: {
          agents: [],
          action_history: [],
          current_dashboard_uuid: "dashboard-1",
          current_dashboard_info: null,
          current_page_context: "dashboard",
        },
      }),
    }),
}));
vi.mock("~/lib/state/mcpTools", () => ({
  useShallowMcpToolsStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      getEnabledToolsForAgent: vi.fn(async () => []),
      getEnabledToolCount: () => 0,
    }),
}));
vi.mock("~/lib/state/skillsLibrary", () => ({
  useShallowSkillsLibraryStore: (
    selector: (state: Record<string, unknown>) => unknown,
  ) =>
    selector({
      getSkillsCatalog: () => [],
      getSkillBySlug: () => undefined,
      skills: [],
    }),
}));
vi.mock("~/lib/utils", () => ({ extractUrlsFromText: () => [] }));

import { useAiFetchRequestInit } from "~/components/AI/hooks/useAiFetchRequestInit";
import type { CopilotWidget } from "~/lib/state/copilot";
import { useCopilotAccessStore } from "~/lib/state/copilotAccess";

async function getPayloads() {
  const { result } = renderHook(() => useAiFetchRequestInit());
  const [getQueryFetchParams, getFunctionCallFetchParams] = result.current;
  const abortSignal = new AbortController().signal;

  const queryParams = await getQueryFetchParams({
    incomingMessage: "hello",
    abortSignal,
  });
  const functionCallParams = await getFunctionCallFetchParams({
    xHeaders: {},
    abortSignal,
  });

  return [
    JSON.parse(queryParams.init.body as string),
    JSON.parse(functionCallParams.init.body as string),
  ];
}

// Chat attachments become temporary widgets without a `uuid` (only `widget_id`),
// mirroring useGetCopilotWidgets' temporaryWidgets.
const makeAttachmentWidget = (uuid: string, name: string) => ({
  origin: "the backend",
  widget_id: `file-${uuid}`,
  name,
  description: name,
  params: [],
  metadata: { extension: name.split(".").pop() },
});

describe("useAiFetchRequestInit", () => {
  beforeEach(() => {
    mockState.selectedCopilot.features["widget-global-search"] = true;
    mockState.temporaryWidgets = [];
    mockState.customFeatureStates = {};
    delete (mockState.selectedCopilot.features as Record<string, unknown>).model;
    useCopilotAccessStore.setState({ access: null });
  });

  describe("an agent that offers its models through its model setting", () => {
    const grant = (...modelIds: string[]) =>
      useCopilotAccessStore.setState({
        access: {
          models: modelIds.map((model_id) => ({
            agent_id: "default_agent",
            model_id,
          })),
          mcp: [],
        },
      });

    beforeEach(() => {
      (mockState.selectedCopilot.features as Record<string, unknown>).model = {
        label: "Model",
        type: "select",
        default: "large",
        options: [
          { label: "Large", value: "large" },
          { label: "Small", value: "small" },
        ],
      };
    });

    it("sends the model the user picked when their roles grant it", async () => {
      grant("large", "small");
      mockState.customFeatureStates = { model: "small" };

      for (const payload of await getPayloads()) {
        expect(payload.workspace_options.model).toBe("small");
      }
    });

    it("sends a model their roles grant in place of one they do not", async () => {
      grant("small");
      mockState.customFeatureStates = { model: "large" };

      for (const payload of await getPayloads()) {
        expect(payload.workspace_options.model).toBe("small");
      }
    });
  });

  it("sends no provider keys: the agent gets them from the API", async () => {
    const payloads = await getPayloads();

    for (const payload of payloads) {
      expect(payload).not.toHaveProperty("api_keys");
    }
  });

  it("always sends the widgets of the whole library to an agent that can search them", async () => {
    const payloads = await getPayloads();

    for (const payload of payloads) {
      expect(payload.workspace_options["widget-global-search"]).toBe(true);
      expect(payload.widgets.extra).toEqual([mockState.allWidget]);
    }
  });

  it("sends no library widgets to an agent that cannot search them", async () => {
    mockState.selectedCopilot.features["widget-global-search"] = false;

    const payloads = await getPayloads();

    for (const payload of payloads) {
      expect(payload.workspace_options["widget-global-search"]).toBeUndefined();
      expect(payload.widgets.extra).toEqual([]);
    }
  });

  it("keeps every attached file widget in primary, not just the first", async () => {
    mockState.temporaryWidgets = [
      makeAttachmentWidget("2f462215-70da-40a5-a015-966f806113d4", "logs.csv"),
      makeAttachmentWidget("5a45b381-d941-48c0-b095-64328ba88c40", "photo1.jpg"),
      makeAttachmentWidget("7c11d0aa-3b2f-4d6e-9c8b-2f0e5a1b4c6d", "photo2.jpg"),
    ];

    const payloads = await getPayloads();

    for (const payload of payloads) {
      const primaryIds = payload.widgets.primary.map(
        (w: { widget_id: string }) => w.widget_id,
      );
      expect(primaryIds).toEqual([
        "file-2f462215-70da-40a5-a015-966f806113d4",
        "file-5a45b381-d941-48c0-b095-64328ba88c40",
        "file-7c11d0aa-3b2f-4d6e-9c8b-2f0e5a1b4c6d",
      ]);
    }
  });
  it("sends a picked skill of the agent's by its slug, without instructions", async () => {
    const { result } = renderHook(() => useAiFetchRequestInit());
    const [getQueryFetchParams] = result.current;

    const { init } = await getQueryFetchParams({
      incomingMessage: "/skill:html-report make a report",
      abortSignal: new AbortController().signal,
    });

    expect(JSON.parse(init.body as string).selected_skills).toEqual([
      { slug: "html-report", description: "HTML reports", source: "forced_slash" },
    ]);
  });

  it("sends nothing for a picked slug that is neither the user's skill nor the agent's", async () => {
    const { result } = renderHook(() => useAiFetchRequestInit());
    const [getQueryFetchParams] = result.current;

    const { init } = await getQueryFetchParams({
      incomingMessage: "/skill:no-such-skill go",
      abortSignal: new AbortController().signal,
    });

    expect(JSON.parse(init.body as string).selected_skills).toBeUndefined();
  });
});
