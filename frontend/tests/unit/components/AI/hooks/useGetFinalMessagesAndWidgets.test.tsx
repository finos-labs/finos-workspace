import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetCurrentChat = vi.fn();
const mockRemoveMessages = vi.fn();
const mockGetDashboardWidgetData = vi.fn();
const mockGetCopilotWidgets = vi.fn();
const mockGetWidgetData = vi.fn();
const mockProcessMentions = vi.fn((content: string) => ({
  result: content,
  mentions: [],
}));

vi.mock("~/lib/state/copilot", () => ({
  useShallowCopilotStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      getCurrentChat: mockGetCurrentChat,
      removeMessages: mockRemoveMessages,
    }),
}));

vi.mock("~/lib/state/copilotData", () => ({
  useShallowCopilotDataStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      getDashboardWidgetData: mockGetDashboardWidgetData,
      getCopilotWidgets: mockGetCopilotWidgets,
    }),
}));

vi.mock("~/lib/utils", () => ({
  AVAILABLE_FUNCTIONS: ["get_widget_data"],
  isWidgetDataFunctionCall: (message: { function?: string }) =>
    message.function === "get_widget_data",
}));

vi.mock("~/components/AI/hooks/useFunctionCall", () => ({
  useFunctionCall: () => ({
    getWidgetData: mockGetWidgetData,
  }),
}));

vi.mock("~/components/AI/hooks/useMentions", () => ({
  useMentions: () => ({
    processMentions: mockProcessMentions,
  }),
}));

vi.mock("~/components/AI/hooks/useWidgetsInCurrentDashboard", () => ({
  useWidgetsInCurrentDashboard: () => vi.fn(),
}));

vi.mock("~/components/AI/hooks/useGetCopilotWidgets", () => ({
  createCopilotWidget: vi.fn(),
}));

import { useGetFinalMessagesAndWidgets } from "~/components/AI/hooks/useGetFinalMessagesAndWidgets";

describe("useGetFinalMessagesAndWidgets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCopilotWidgets.mockReturnValue({
      allDashboardWidgets: [{ uuid: "widget-1" }],
    });
    mockGetCurrentChat.mockReturnValue({
      messages: [
        {
          role: "tool",
          function: "get_widget_data",
          timestamp: 123,
          input_arguments: {
            data_sources: [
              {
                origin: "the backend",
                id: "file-widget-1",
                widget_uuid: "widget-1",
                input_args: {},
              },
            ],
          },
          data: [
            {
              error_type: "not_found",
              content: "File with id file-widget-1 not found",
            },
          ],
          extra_state: {
            copilot_function_call_arguments: {
              widget_queries: [
                { widget_uuid: "widget-1", query: "what's this about?" },
              ],
            },
          },
        },
      ],
    });
  });

  it("skips renewal for stale tool messages with error payloads", async () => {
    const { result } = renderHook(() => useGetFinalMessagesAndWidgets());

    await expect(result.current()).resolves.toEqual({
      finalMessages: [
        {
          role: "tool",
          function: "get_widget_data",
          input_arguments: {
            data_sources: [
              {
                origin: "the backend",
                id: "file-widget-1",
                widget_uuid: "widget-1",
                input_args: {},
              },
            ],
          },
          data: [
            {
              error_type: "not_found",
              content: "File with id file-widget-1 not found",
            },
          ],
          extra_state: {
            copilot_function_call_arguments: {
              widget_queries: [
                { widget_uuid: "widget-1", query: "what's this about?" },
              ],
            },
          },
        },
      ],
      finalDashboardWidgets: [{ uuid: "widget-1" }],
      mentionWidgets: [],
    });

    expect(mockGetWidgetData).not.toHaveBeenCalled();
    expect(mockRemoveMessages).toHaveBeenCalledWith([]);
  });

  it("strips attached files from human messages sent to the backend", async () => {
    mockGetCurrentChat.mockReturnValue({
      messages: [
        {
          role: "human",
          content: "summarize this",
          copilotId: "default-copilot",
          timestamp: 123,
          files: [
            {
              name: "dailyreport.pdf",
              description: "a report",
              status: "uploaded",
              stored_file_uuid: "uuid-1",
            },
          ],
        },
      ],
    });

    const { result } = renderHook(() => useGetFinalMessagesAndWidgets());
    const { finalMessages } = await result.current();

    expect(finalMessages).toEqual([{ role: "human", content: "summarize this" }]);
  });

  it("keeps an answer that is JSON itself, and removes only a call of a function it does not know", async () => {
    const answers = ["18", "true", "null", '"yes"', "[1, 2]", '{"total": 3}'];
    mockGetCurrentChat.mockReturnValue({
      messages: [
        {
          role: "human",
          content: "what is 9 plus 9?",
          copilotId: "ines",
          timestamp: 1,
        },
        ...answers.map((content, i) => ({
          role: "ai",
          content,
          copilotId: "ines",
          timestamp: 10 + i,
        })),
        {
          role: "ai",
          content: JSON.stringify({
            function: "no_such_function",
            input_arguments: {},
          }),
          copilotId: "ines",
          timestamp: 99,
        },
      ],
    });

    const { result } = renderHook(() => useGetFinalMessagesAndWidgets());
    const { finalMessages } = await result.current();

    expect(finalMessages).toEqual([
      { role: "human", content: "what is 9 plus 9?" },
      ...answers.map((content) => ({ role: "ai", content, agent_id: "ines" })),
    ]);
    expect(mockRemoveMessages).toHaveBeenCalledWith([99]);
  });
});
