/**
 * What the chat is shown while an answer arrives: nothing until it is whole.
 *
 * Text is never rendered token by token, whatever the agent sends. A message chunk (and an artifact or
 * citation marker) is only held; the answer is put in the chat as one message when the text is complete:
 * at the next status update or function call, or when the stream is done. Status updates (the reasoning)
 * are shown as they arrive. Stopping keeps what was held, as a cancelled message.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStreamingStore } from "~/components/AI/hooks/useStreaming";
import { useHandleStreaming } from "~/components/AI/hooks/useStreamResponse";
import {
  type AIMessage,
  type Chat,
  type Copilot,
  type Message,
  useCopilotStore,
} from "~/lib/state/copilot";

const tools = vi.hoisted(() => ({
  executeAgentTool: vi.fn(),
  executeWorkspaceTool: vi.fn(),
}));

const context = vi.hoisted(() => ({
  commandRef: { current: "" },
  handleSubmitRef: { current: null as null | ((params?: unknown) => Promise<void>) },
  stopSubmitRef: { current: null as null | (() => void) },
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
}));
vi.mock("sonner", () => ({
  toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
}));
vi.mock("~/lib/contexts/CopilotChatContext", () => ({
  useCopilotContext: () => context,
}));
vi.mock("~/components/AI/hooks/useQueriesLeft", () => ({
  default: () => ({ queriesLeft: 10 }),
}));
vi.mock("~/lib/state/auth", () => ({
  useShallowAuthStore: (selector: (s: { user: { token: string } }) => unknown) =>
    selector({ user: { token: "token" } }),
}));
vi.mock("~/lib/state/app", () => ({
  useAppStore: { getState: () => ({ items: {} }) },
  useShallowAppStore: (selector: (s: { addTab: () => void }) => unknown) =>
    selector({ addTab: vi.fn() }),
}));
vi.mock("~/lib/state/backendConnector", () => ({
  useShallowBackendConnectorStore: (
    selector: (s: { apiSources: never[] }) => unknown,
  ) => selector({ apiSources: [] }),
}));
vi.mock("~/lib/state/copilotData", () => ({
  useShallowCopilotDataStore: (
    selector: (s: { generativeUiEnabled: boolean }) => unknown,
  ) => selector({ generativeUiEnabled: false }),
}));
vi.mock("~/lib/state/skillsLibrary", () => ({
  useShallowSkillsLibraryStore: (
    selector: (s: { getSkillBySlug: () => void }) => unknown,
  ) => selector({ getSkillBySlug: vi.fn() }),
}));
vi.mock("~/lib/state/theme", () => ({
  useShallowThemeStore: (selector: (s: { aiEnhancements: boolean }) => unknown) =>
    selector({ aiEnhancements: false }),
  useThemeStore: { getState: () => ({ setPendingExport: vi.fn() }) },
}));
vi.mock("~/lib/utils/createTemplates", () => ({ createCustomTemplateTab: vi.fn() }));
vi.mock("~/components/AI/hooks/useFunctionCall", () => ({
  useFunctionCall: () => ({
    getWidgetData: vi.fn(),
    getParamOptions: vi.fn(),
    addWidgetToDashboard: vi.fn(),
    updateWidgetInDashboard: vi.fn(),
    assignTasksToAgents: vi.fn(),
    addGenerativeWidget: vi.fn(),
  }),
}));
vi.mock("~/components/AI/hooks/useManageNavigationBar", () => ({
  useManageNavigationBar: () => vi.fn(),
}));
vi.mock("~/components/AI/hooks/mcp/useMcpExecutor", () => ({
  useMcpExecutor: () => tools.executeAgentTool,
}));
vi.mock("~/components/AI/hooks/useWorkspaceToolExecutor", () => ({
  useWorkspaceToolExecutor: () => tools.executeWorkspaceTool,
}));
vi.mock("~/components/AI/hooks/useCreateSkillFromConversation", () => ({
  useCreateSkillFromConversation: () => vi.fn(),
}));
vi.mock("~/components/AI/hooks/useAiFetchRequestInit", () => ({
  useAiFetchRequestInit: () => [
    async () => ({ queryUrl: "http://agent.test/query", init: {} }),
    async () => ({ queryUrl: "http://agent.test/query", init: {} }),
    async () => ({ queryUrl: "http://agent.test/title", init: {} }),
  ],
}));

const COPILOT = { id: "default-copilot", name: "Copilot" } as unknown as Copilot;
const CHAT_CREATED_AT = 1710000000000;

const encoder = new TextEncoder();
const sse = (event: string, data: unknown) =>
  encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

/** A response that the test feeds one event at a time. */
function openStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({
        "X-Trace-Id": "trace-1",
        "X-Completion-ID": "completion-1",
      }),
      body,
    }),
  );
  return {
    send: async (event: string, data: unknown = {}) => {
      controller.enqueue(sse(event, data));
      // Let the reader take it and the handler finish with it.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    },
    end: async () => {
      controller.close();
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    },
  };
}

const chatMessages = (): Message[] =>
  useCopilotStore.getState().chats.find((c) => c.createdAt === CHAT_CREATED_AT)
    ?.messages ?? [];

const aiMessages = (): AIMessage[] =>
  chatMessages().filter((m): m is AIMessage => m.role === "ai");

const statusMessages = (): string[] =>
  chatMessages().flatMap((m) => (m.role === "system" ? [m.content.message] : []));

const held = () => window.localStorage.getItem("streamedData");

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function startAsking() {
  renderHook(() => useHandleStreaming(), { wrapper });
  const stream = openStream();
  let finished: Promise<void> | undefined;
  await act(async () => {
    finished = context.handleSubmitRef.current?.({ question: "summarize prices" });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  // Swallow the promise of the whole run: it ends when the stream is closed.
  void finished?.catch(() => {});
  return stream;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  context.commandRef.current = "";
  context.handleSubmitRef.current = null;
  context.stopSubmitRef.current = null;
  useStreamingStore.setState({
    streamingStatus: "streaming-ready",
    loading: false,
    abortController: null,
    limitReached: false,
    files: [],
  });
  const chat: Chat = {
    uuid: "chat-1",
    createdAt: CHAT_CREATED_AT,
    label: "Test chat",
    lastInteraction: CHAT_CREATED_AT,
    messages: [],
    agentIds: [],
  };
  useCopilotStore.setState({
    chats: [chat],
    currentChat: CHAT_CREATED_AT,
    selectedCopilot: COPILOT,
  });
});

describe("the answer", () => {
  it("is not in the chat while its chunks arrive, and is one message when the stream is done", async () => {
    const stream = await startAsking();
    await waitFor(() => expect(chatMessages()).toHaveLength(1)); // the question

    await stream.send("copilotMessageChunk", { delta: "Top close " });
    await stream.send("copilotMessageChunk", { delta: "is 200." });

    // Held: nothing of it is in the chat, and the chat is still working on it.
    expect(aiMessages()).toHaveLength(0);
    expect(useStreamingStore.getState().loading).toBe(true);
    expect(useStreamingStore.getState().streamingStatus).toBe("streaming-ready");

    await stream.send("done");
    await stream.end();

    expect(aiMessages().map((m) => m.content)).toEqual(["Top close is 200."]);
    expect(useStreamingStore.getState().loading).toBe(false);
  });

  it("is put in the chat once, however many times the stream says it is done", async () => {
    const stream = await startAsking();
    await stream.send("copilotMessageChunk", { delta: "Top close is 200." });
    await stream.send("done");
    await stream.send("done");
    await stream.end();

    expect(aiMessages()).toHaveLength(1);
  });

  it("is the same when it comes as one chunk", async () => {
    const stream = await startAsking();
    await stream.send("copilotMessageChunk", { delta: "Top close is 200." });
    expect(aiMessages()).toHaveLength(0);
    await stream.send("done");
    await stream.end();

    expect(aiMessages().map((m) => m.content)).toEqual(["Top close is 200."]);
  });

  it("keeps the artifacts and citations that come with it, in order, in the one message", async () => {
    const stream = await startAsking();
    await stream.send("copilotMessageArtifact", {
      name: "Prices",
      type: "table",
      uuid: "a1",
    });
    await stream.send("copilotMessageChunk", { delta: "Top close is 200." });
    await stream.send("copilotCitationCollection", {
      citations: [
        { id: "c1", source_info: { type: "widget", name: "W" }, signature: "s" },
      ],
    });
    expect(aiMessages()).toHaveLength(0);
    await stream.send("done");
    await stream.end();

    const [message] = aiMessages();
    expect(aiMessages()).toHaveLength(1);
    expect(message.content).toBe(
      '<artifact className="Prices"/>Top close is 200.<citation className="c1"/>',
    );
    expect(message.citations?.map((c) => c.id)).toEqual(["c1"]);
  });

  it("carries the follow-up suggestions that arrive before the stream is done", async () => {
    const stream = await startAsking();
    await stream.send("copilotMessageChunk", { delta: "Top close is 200." });
    await stream.send("copilotPromptSuggestions", {
      suggestions: ["Show AAPL", "Show NVDA"],
    });
    expect(aiMessages()).toHaveLength(0);
    await stream.send("done");
    await stream.end();

    expect(aiMessages()).toHaveLength(1);
    expect(aiMessages()[0].suggestions).toEqual(["Show AAPL", "Show NVDA"]);
  });

  it("carries the ids that the Workspace gave the completion", async () => {
    const stream = await startAsking();
    await stream.send("copilotMessageChunk", { delta: "Top close is 200." });
    await stream.send("done");
    await stream.end();

    expect(aiMessages()[0].traceId).toBe("trace-1");
    expect(aiMessages()[0].completionId).toBe("completion-1");
  });
});

describe("the reasoning", () => {
  it("is shown as it arrives, before the answer", async () => {
    const stream = await startAsking();
    await stream.send("copilotStatusUpdate", {
      eventType: "INFO",
      message: "Looking at the top close.",
      group: "reasoning",
    });

    expect(statusMessages()).toEqual(["Looking at the top close."]);
    expect(aiMessages()).toHaveLength(0);

    await stream.send("copilotMessageChunk", { delta: "Top close is 200." });
    await stream.send("done");
    await stream.end();

    const roles = chatMessages().map((m) => m.role);
    expect(roles).toEqual(["human", "system", "ai"]);
  });

  it("puts the text held so far in the chat before the status that follows it", async () => {
    const stream = await startAsking();
    await stream.send("copilotMessageChunk", { delta: "First part." });
    expect(aiMessages()).toHaveLength(0);
    await stream.send("copilotStatusUpdate", {
      eventType: "INFO",
      message: "Running a query.",
      group: "reasoning",
    });
    expect(chatMessages().map((m) => m.role)).toEqual(["human", "ai", "system"]);
    expect(aiMessages()[0].content).toBe("First part.");
    // What was held is not held twice.
    expect(held()).toBe(JSON.stringify(""));

    await stream.send("copilotMessageChunk", { delta: "Second part." });
    await stream.send("done");
    await stream.end();

    expect(aiMessages().map((m) => m.content)).toEqual(["First part.", "Second part."]);
  });
});

describe("stopping", () => {
  it("keeps the text that was held, as a cancelled message", async () => {
    const stream = await startAsking();
    await stream.send("copilotMessageChunk", { delta: "Top close is" });
    expect(aiMessages()).toHaveLength(0);

    await act(async () => {
      context.stopSubmitRef.current?.();
    });

    expect(aiMessages()).toHaveLength(1);
    expect(aiMessages()[0]).toMatchObject({
      content: "Top close is",
      isCancelled: true,
    });
    expect(useStreamingStore.getState().loading).toBe(false);
    await stream.end().catch(() => {});
  });

  it("marks the message that is in the chat as cancelled when nothing is held", async () => {
    const stream = await startAsking();
    await stream.send("copilotMessageChunk", { delta: "First part." });
    await stream.send("copilotStatusUpdate", {
      eventType: "INFO",
      message: "Running a query.",
      group: "reasoning",
    });
    await act(async () => {
      context.stopSubmitRef.current?.();
    });

    // The status is the last message, so the cancelled answer is a new, empty one.
    expect(aiMessages().map((m) => m.content)).toEqual(["First part.", ""]);
    expect(aiMessages()[1].isCancelled).toBe(true);
    await stream.end().catch(() => {});
  });
});

describe("a call of a tool", () => {
  async function callTool(serverId: string) {
    const stream = await startAsking();
    await waitFor(() => expect(chatMessages()).toHaveLength(1)); // the question
    // What the call is answered with is sent to the agent, which has nothing more to say.
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      headers: new Headers(),
      body: new ReadableStream<Uint8Array>({ start: (c) => c.close() }),
    } as Response);
    await stream.send("copilotFunctionCall", {
      function: "execute_agent_tool",
      input_arguments: {
        server_id: serverId,
        tool_name: "Workspace_get_widget_data",
        parameters: { origin: "Options", widget_id: "chain" },
      },
      extra_state: {},
    });
    await stream.end();
  }

  it("of the Workspace is run by this tab, not by an MCP server", async () => {
    tools.executeWorkspaceTool.mockResolvedValue([{ items: [{ content: "{}" }] }]);

    await callTool("workspace");

    await waitFor(() => expect(tools.executeWorkspaceTool).toHaveBeenCalledTimes(1));
    expect(tools.executeWorkspaceTool).toHaveBeenCalledWith(
      "Workspace_get_widget_data",
      { origin: "Options", widget_id: "chain" },
    );
    expect(tools.executeAgentTool).not.toHaveBeenCalled();
  });

  it("of any other server goes to that server", async () => {
    tools.executeAgentTool.mockResolvedValue([{ items: [{ content: "{}" }] }]);

    await callTool("tools");

    await waitFor(() => expect(tools.executeAgentTool).toHaveBeenCalledTimes(1));
    expect(tools.executeAgentTool).toHaveBeenCalledWith(
      "tools",
      "Workspace_get_widget_data",
      { origin: "Options", widget_id: "chain" },
    );
    expect(tools.executeWorkspaceTool).not.toHaveBeenCalled();
  });
});
