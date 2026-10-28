import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { useLocalStorage } from "usehooks-ts";
import { useCallbackRef } from "~/hooks/useRefHooks";
import { useCopilotContext } from "~/lib/contexts/CopilotChatContext";
import { getConfig } from "~/lib/runtimeConfig";
import { fetchAgent } from "~/lib/state/agentToken";
import { useAppStore, useShallowAppStore } from "~/lib/state/app";
import {
  type BackendTemplate,
  useShallowBackendConnectorStore,
} from "~/lib/state/backendConnector";
import {
  type AIMessage,
  type AppArtifactT,
  type ArtifactT,
  type Citation as CitationT,
  type Copilot,
  type CopilotCommandResultT,
  type CopilotDataT,
  type CopilotFile,
  type CopilotFunctionCallError,
  type Message,
  type SystemSSEContent,
  type ToolMessage,
  useCopilotStore,
  useShallowCopilotStore,
} from "~/lib/state/copilot";
import { useShallowSkillsLibraryStore } from "~/lib/state/skillsLibrary";
import { useShallowThemeStore, useThemeStore } from "~/lib/state/theme";
import { WORKSPACE_SERVER_ID } from "~/lib/state/workspaceTools";
import {
  type AddGenerativeWidgetInputArgumentsT,
  type FunctionCallT,
  functionCallSchema,
  manageNavigationBarInputArguments,
} from "~/lib/utils";
import { createCustomTemplateTab } from "~/lib/utils/createTemplates";
import type { SkillPayload } from "~/types/auth.type";
import {
  buildAppArtifactSource,
  buildWidgetSourceResolver,
  shouldAutoOpenAppArtifact,
} from "../appArtifactUtils";
import { useMcpExecutor } from "./mcp/useMcpExecutor";
import { useAiFetchRequestInit, type XHeadersT } from "./useAiFetchRequestInit";
import { useCreateSkillFromConversation } from "./useCreateSkillFromConversation";
import { useFunctionCall } from "./useFunctionCall";
import { useManageNavigationBar } from "./useManageNavigationBar";
import useQueriesLeft from "./useQueriesLeft";
import {
  ResetState,
  type StreamingData,
  type StreamingState,
  StreamingStatus,
  useShallowStreamingStore,
  useStreamingHooks,
  useStreamingStore,
} from "./useStreaming";
import { useWorkspaceToolExecutor } from "./useWorkspaceToolExecutor";
import {
  dispatchCopilotCommand,
  normalizeCitations,
  partitionFilesOnSend,
} from "./utils";

export type CopilotSubmitParams = {
  question?: string;
  addHumanMessage?: boolean;
  mockResponse?:
    | string
    | {
        messageContent: string;
        citations?: CitationT[];
        artifact?: ArtifactT;
      };
};

const aiCopilotAiEnhancementsFF =
  getConfig().copilot.enabled && getConfig().copilot.aiEnhancements;

type StreamAccumulator = {
  accumulatedMessageData: string;
  accumulatedCitations: CitationT[];
};

const createFunctionCallMessages = (
  dataOrResults: (CopilotDataT | CopilotFunctionCallError)[] | CopilotCommandResultT[],
  functionCallSpec: FunctionCallT,
) => {
  const aiMessage = {
    role: "ai",
    content: JSON.stringify({
      function: functionCallSpec.function,
      input_arguments: functionCallSpec?.input_arguments,
    }),
  } as AIMessage;
  const toolMessage = {
    role: "tool",
    function: functionCallSpec.function,
    input_arguments: functionCallSpec?.input_arguments,
    data: dataOrResults,
    extra_state: functionCallSpec?.extra_state,
  } as ToolMessage;
  return { aiMessage, toolMessage };
};

function useStreamResponse(stopSubmit: () => void) {
  const navigate = useNavigate();
  const { id: currentDashboard } = useParams();
  const commandRef = useCopilotContext().commandRef;
  const [limitReached, abortController, streamingStatus, dispatch] =
    useShallowStreamingStore((s) => [
      s.limitReached,
      s.abortController,
      s.streamingStatus,
      s.dispatch,
    ]);

  const [_, setStreamedData] = useLocalStorage("streamedData", "");
  const [__, setStreamedCitations] = useLocalStorage<CitationT[]>(
    "streamedCitations",
    [],
  );

  const aiEnhancements = useShallowThemeStore((state) => state.aiEnhancements);

  const queriesLeft = useQueriesLeft()?.queriesLeft;

  const addTab = useShallowAppStore((s) => s.addTab);
  const apiSources = useShallowBackendConnectorStore((s) => s.apiSources);

  const copilot = useShallowCopilotStore((s) => ({
    addArtifactToCurrentChat: s.addArtifactToCurrentChat,
    selectedCopilot: s.selectedCopilot,
    setIsTyping: s.setIsTyping,
    updateLastMessage: s.updateLastMessage,
    updateLastMessageError: s.updateLastMessageError,
    makeLastMessageFC: s.makeLastMessageFC,
    addMessage: s.addMessage,
    removeMessages: s.removeMessages,
    getCurrentChat: s.getCurrentChat,
    updateCopilotLabelAndSetTitleNeedsUpdate:
      s.updateCopilotLabelAndSetTitleNeedsUpdate,
  }));

  const [
    getQueryFetchParams,
    getFunctionCallFetchParams,
    getUpdateCopilotTitleFetchParams,
  ] = useAiFetchRequestInit();
  const {
    getWidgetData,
    getParamOptions,
    addWidgetToDashboard,
    updateWidgetInDashboard,
    assignTasksToAgents,
    addGenerativeWidget,
  } = useFunctionCall();
  const manageNavigationBar = useManageNavigationBar();

  // MCP tool execution; the FINOS Workspace's own tools are run by this tab
  const executeAgentTool = useMcpExecutor();
  const executeWorkspaceTool = useWorkspaceToolExecutor();

  // Skills store access for get_skill_content function call
  const getSkillBySlug = useShallowSkillsLibraryStore((s) => s.getSkillBySlug);

  // Save the current conversation as a skill (save_skill function call)
  const createSkillFromConversation = useCreateSkillFromConversation();

  // Add a new ref to store the resolution function
  const resolveStreamRef = useRef<(() => void) | null>(null);
  const handleEventRef =
    useRef<(props: HandleEventProps) => Promise<StreamAccumulator>>();

  // Store pending MCP citations across streaming lifecycle (accumulates across multiple tool calls)
  const pendingMcpCitationsRef = useRef<CitationT[]>([]);

  // Follow-up suggestions that arrive before the answer they belong to is put in the chat.
  const pendingSuggestionsRef = useRef<string[] | null>(null);
  /** The pending "put the cursor back in the question box" timer, so it can be cancelled. */
  const focusInputRef = useRef<ReturnType<typeof setTimeout>>();

  const autoOpenAppArtifact = useCallback(
    async (artifact: AppArtifactT) => {
      // Read items imperatively: back-to-back artifacts in one stream must see the dashboard
      // state left by the previous auto-open, which the render closure would not reflect.
      const items = useAppStore.getState().items;
      const currentDashboardItem = currentDashboard ? items?.[currentDashboard] : null;
      if (!shouldAutoOpenAppArtifact({ currentDashboardItem })) return;

      try {
        await createCustomTemplateTab({
          addTab,
          navigate,
          items,
          template: artifact.app as unknown as BackendTemplate,
          source: buildAppArtifactSource(artifact),
          currentDashboard: currentDashboard ?? "",
          dashboardBehavior: "current",
          resolveWidgetSource: buildWidgetSourceResolver(
            artifact.widget_refs ?? [],
            apiSources,
          ),
        });
      } catch (error) {
        toast.error("Failed to open app", {
          description: error instanceof Error ? error.message : "Unexpected error",
        });
      }
    },
    [addTab, navigate, currentDashboard, apiSources],
  );

  const updateCopilotTitle = useCallback(
    async (xTraceId: string) => {
      // only update the title if the title needs to be updated, i.e.
      //   1. the title is "New Chat" because it hasn't been manually updated by the user
      //   2. one of the messages has been edited and so we re-update the title in case it changes topic of conversation
      //   3. the title has never been updated and we need to generate a title
      // Note: if the user manually updates the title, we don't want to overwrite it

      const { titleManuallyUpdated, titleNeedsUpdate, messages } =
        copilot.getCurrentChat();
      if (!(!titleManuallyUpdated && titleNeedsUpdate && messages.length > 1)) return;
      const { url, init } = await getUpdateCopilotTitleFetchParams({ xTraceId });
      try {
        const response = await fetchAgent(url, init);
        if (!response.ok) throw new Error(response.statusText);
        const data = await response.json();
        copilot.updateCopilotLabelAndSetTitleNeedsUpdate(data, false);
      } catch (e) {
        console.error(e);
        return;
      }
    },
    [copilot.getCurrentChat, copilot.updateCopilotLabelAndSetTitleNeedsUpdate],
  );

  const processStream = useCallback(
    async (
      xHeaders: XHeadersT,
      reader: ReadableStreamDefaultReader,
      abortSignal: AbortSignal,
      question: string,
      keepAlive = false, // Whether to keep the streaming state alive after processing the stream
      targetAgent?: Copilot,
    ) => {
      const decoder = new TextDecoder("utf-8");
      let accumulatedMessageData = "";
      let accumulatedCitations: CitationT[] = [];
      let streamBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (handleEventRef.current)
            handleEventRef.current({
              event: "done",
              question,
              accumulatedMessageData,
              accumulatedCitations,
              abortSignal,
              xHeaders,
              keepAlive,
              targetAgent,
            });
          break;
        }
        /*
          each chunk is the following:
          event: message_chunk
          data: {'delta': '...'}

          event: message_chunk
          data: {'delta': '...'}

          etc
      */
        const chunk = decoder.decode(value, { stream: true });
        streamBuffer += chunk;
        const events = streamBuffer.split(/\r\n\r\n|\r\r|\n\n/g);

        // The leftover text to remain in the buffer is whatever doesn't have two newlines after it. If the buffer ended
        // with two newlines, this will be an empty string.
        streamBuffer = events.pop() ?? "";
        let event = "";

        for (const eventChunk of events) {
          // Split up by single newlines.
          const lines = eventChunk.split(/\n|\r|\r\n/g);
          let data = "";
          for (const line of lines) {
            try {
              const lineMatch = /(?<field>[^:]+)(?:: ?(?<value>.*))?/.exec(line);
              if (lineMatch) {
                const groups = lineMatch.groups || {};
                const value = groups.value || "";

                switch (groups.field) {
                  case "event":
                    event = value;
                    break;
                  case "data": {
                    data += value;
                    data += "\n";
                    break;
                  }
                  // other types are explicitly ignored
                }
              }
            } catch (e) {
              console.error(e);
            }
          }
          // Skip the event if the data buffer is the empty string.
          if (data === "") continue;

          // Remove the last newline character if it exists
          if (data[data.length - 1] === "\n") {
            data = data.slice(0, -1);
          }

          // Parse the data as JSON
          const parsedData: unknown = JSON.parse(data);

          if (handleEventRef.current)
            ({ accumulatedMessageData, accumulatedCitations } =
              await handleEventRef.current({
                event,
                data: parsedData,
                question,
                accumulatedMessageData,
                accumulatedCitations,
                abortSignal,
                xHeaders,
                keepAlive,
                targetAgent,
              }));
        }
      }
    },
    [handleEventRef],
  );

  const submitFunctionCallResponse = useCallback(
    async (
      props: HandleFunctionCallProps,
      dataOrResults:
        | (CopilotDataT | CopilotFunctionCallError)[]
        | CopilotCommandResultT[],
    ) => {
      const { incomingMessage, abortSignal, xHeaders, functionCallSpec, targetAgent } =
        props;
      const copilotId = targetAgent?.id || copilot.selectedCopilot?.id;

      const updateChatMessages = (aiMessage: AIMessage, toolMessage: ToolMessage) => {
        if (!copilot.selectedCopilot || !copilotId) return;
        copilot.addMessage({
          ...aiMessage,
          copilotId,
          timestamp: Date.now(),
          isHidden: true,
        });
        copilot.addMessage({
          ...toolMessage,
          copilotId,
          timestamp: Date.now() + 1,
          isHidden: true,
        });
      };

      const { aiMessage, toolMessage } = createFunctionCallMessages(
        dataOrResults,
        functionCallSpec,
      );

      // Extract MCP extra_citations (if any) and accumulate for injection at 'done'
      if (
        functionCallSpec.function === "execute_agent_tool" &&
        Array.isArray(dataOrResults)
      ) {
        const citations = dataOrResults.flatMap((item): unknown[] => {
          const extra = (item as { extra_citations?: unknown } | null)?.extra_citations;
          return Array.isArray(extra) ? extra : [];
        });
        if (citations.length > 0) {
          const normalized = normalizeCitations(citations);
          // Deduplicate by id while accumulating
          const existingIds = new Set(pendingMcpCitationsRef.current.map((c) => c.id));
          const toAdd = normalized.filter((c) => !existingIds.has(c.id));
          pendingMcpCitationsRef.current.push(...toAdd);
        }
      }

      updateChatMessages(aiMessage, toolMessage);

      const { queryUrl, init } = await getFunctionCallFetchParams({
        xHeaders,
        abortSignal,
        targetAgent,
      });
      const response = await fetchAgent(queryUrl, init);
      if (!response.ok) throw new Error(response.statusText);
      const reader = response.body?.getReader();
      if (!isReadableStream(reader))
        throw new Error("Invalid response from getWidgetDataFunction");
      return await processStream(
        xHeaders,
        reader,
        abortSignal,
        incomingMessage,
        false,
        targetAgent,
      );
    },
    [
      getFunctionCallFetchParams,
      processStream,
      copilot.selectedCopilot?.id,
      copilot.addMessage,
      pendingMcpCitationsRef,
    ],
  );

  const handleFunctionCall = useCallback(
    async (props: HandleFunctionCallProps) => {
      if (!copilot.selectedCopilot) return;
      const { functionCallSpec, xHeaders, abortSignal, incomingMessage } = props;
      copilot.makeLastMessageFC();

      const forwardMessageToAi = async (
        message: string,
        fromAgentId: string,
        targetAgent?: Copilot,
      ) => {
        copilot.addMessage({
          role: "ai",
          content: message,
          copilotId: fromAgentId,
          timestamp: Date.now(),
        });

        const { queryUrl, init } = await getQueryFetchParams({
          incomingMessage: message,
          abortSignal,
          targetAgent,
        });

        const response = await fetchAgent(queryUrl, init);

        if (!response.ok) throw new Error(response.statusText);

        // Check if this is a streaming response
        const contentType = response.headers.get("content-type");

        if (targetAgent && !contentType?.includes("text/event-stream")) {
          // Handle non-streaming response from external agent
          try {
            const jsonResponse = await response.json();

            // Convert to streaming format for compatibility
            // This is a simplified approach - you may need to adjust based on the actual response format
            copilot.addMessage({
              role: "ai",
              content: JSON.stringify(jsonResponse),
              copilotId: targetAgent.id,
              timestamp: Date.now() + 1,
            });
            return;
          } catch (e) {
            throw new Error(
              `Failed to process agent response: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }

        const reader = response.body?.getReader();
        if (!isReadableStream(reader))
          throw new Error("Invalid response from getWidgetDataFunction");
        return await processStream(
          xHeaders,
          reader,
          abortSignal,
          incomingMessage,
          true,
          targetAgent,
        );
      };

      switch (functionCallSpec.function) {
        // We handle both LLM functions in the same way
        case "get_widget_data":
        case "get_extra_widget_data": {
          const data = await getWidgetData(
            functionCallSpec.input_arguments.data_sources || [],
          );
          return await submitFunctionCallResponse(props, data);
        }
        case "get_params_options": {
          const data = await getParamOptions(
            functionCallSpec.input_arguments.param_options_queries || [],
          );
          return await submitFunctionCallResponse(props, data);
        }
        case "add_widget_to_dashboard": {
          const results = await addWidgetToDashboard(
            functionCallSpec.input_arguments.data_sources || [],
          );
          return await submitFunctionCallResponse(props, results);
        }
        case "update_widget_in_dashboard": {
          const results = await updateWidgetInDashboard(
            functionCallSpec.input_arguments.data_sources || [],
          );
          return await submitFunctionCallResponse(props, results);
        }
        case "assign_tasks_to_agents": {
          const results = await assignTasksToAgents(
            functionCallSpec.input_arguments.task_requests || [],
            forwardMessageToAi,
          );
          // If we expect a direct response from the agent, don't show the tool results
          // The agent's response will be displayed directly
          // if any of the tasks failed, we show the results as normal
          const expectDirectResponse =
            functionCallSpec.extra_state?.expect_direct_response &&
            results.every((val) => val.status === "success");

          return await submitFunctionCallResponse(
            props,
            expectDirectResponse ? [] : results,
          );
        }
        case "execute_agent_tool": {
          const { server_id, tool_name, parameters } = functionCallSpec.input_arguments;
          if (!(server_id && tool_name))
            throw new Error("execute_agent_tool requires server_id and tool_name");
          const data =
            server_id === WORKSPACE_SERVER_ID
              ? await executeWorkspaceTool(tool_name, parameters)
              : await executeAgentTool(server_id, tool_name, parameters);
          return await submitFunctionCallResponse(props, data);
        }
        case "manage_navigation_bar": {
          const parsed = manageNavigationBarInputArguments.safeParse(
            functionCallSpec.input_arguments,
          );
          if (!parsed.success) {
            return await submitFunctionCallResponse(props, [
              {
                status: "error",
                message: `Invalid manage_navigation_bar arguments: ${parsed.error.message}`,
              },
            ]);
          }
          const results = await manageNavigationBar(parsed.data);
          return await submitFunctionCallResponse(props, results);
        }
        case "add_generative_widget": {
          const args =
            functionCallSpec.input_arguments as AddGenerativeWidgetInputArgumentsT;
          const results = await addGenerativeWidget(args);
          return await submitFunctionCallResponse(props, results);
        }
        case "get_skill_content": {
          const { slug, reason } = functionCallSpec.input_arguments as {
            slug: string;
            reason?: string;
          };
          const skill = getSkillBySlug(slug);

          if (!skill) {
            return await submitFunctionCallResponse(props, [
              {
                status: "error",
                message: `Skill with slug "/${slug}" not found in user's skill library.`,
              },
            ]);
          }

          const skillPayload: SkillPayload = {
            slug: skill.slug,
            description: skill.description,
            contentMarkdown: skill.content,
            source: "model_selected",
          };

          return await submitFunctionCallResponse(props, [
            {
              status: "success",
              data: { skill: skillPayload },
            },
          ]);
        }
        case "save_skill": {
          const { name, instructions } = functionCallSpec.input_arguments ?? {};
          const results = await createSkillFromConversation({ name, instructions });
          return await submitFunctionCallResponse(props, results);
        }
        default:
          throw new Error(`Unknown function: ${functionCallSpec.function}`);
      }
    },
    [
      copilot,
      getWidgetData,
      getParamOptions,
      addWidgetToDashboard,
      updateWidgetInDashboard,
      executeAgentTool,
      executeWorkspaceTool,
      manageNavigationBar,
      addGenerativeWidget,
      getSkillBySlug,
      createSkillFromConversation,
      getFunctionCallFetchParams,
      getQueryFetchParams,
      processStream,
      submitFunctionCallResponse,
    ],
  );

  const handleEvent = useCallback(
    async (props: HandleEventProps) => {
      const { event, data, question, abortSignal, xHeaders, keepAlive, targetAgent } =
        props;
      let aiMessageBuffer: string = props.accumulatedMessageData;
      let citationBuffer: CitationT[] = props.accumulatedCitations;

      if (!copilot.selectedCopilot) {
        return {
          accumulatedMessageData: aiMessageBuffer,
          accumulatedCitations: citationBuffer,
        };
      }
      const copilotId = targetAgent?.id || copilot.selectedCopilot.id;

      // The answer is held until it is complete and put in the chat whole. Text is never shown token by
      // token, whatever the agent sends: a chunk is only added to the buffer, never rendered by itself.
      const commitAnswer = (extra: Partial<AIMessage> = {}) => {
        if (!aiMessageBuffer) return false;
        const suggestions = pendingSuggestionsRef.current;
        pendingSuggestionsRef.current = null;
        copilot.addMessage({
          role: "ai",
          content: aiMessageBuffer,
          ...(citationBuffer.length > 0 ? { citations: citationBuffer } : {}),
          ...(suggestions ? { suggestions } : {}),
          ...extra,
          copilotId,
          timestamp: Date.now() + 1, // adding 1 to avoid timestamp collision with the human message
        });
        aiMessageBuffer = "";
        citationBuffer = [];
        return true;
      };

      const flushBuffers = () => {
        // Used when there is text held for the answer
        // but there is an incoming FunctionCall or StatusUpdate
        if (!commitAnswer()) return;
        dispatch(
          { ...ResetState, ...StreamingStatus.READY, loading: true },
          setStreamedData,
          setStreamedCitations,
        );
      };

      switch (event.trim()) {
        case "copilotStatusUpdate": {
          flushBuffers();
          const content = data as SystemSSEContent;
          // Hidden updates are not shown in the chat, but
          // the state is still loading until the next message
          if (content.hidden) break;
          if (content.eventType === "WARNING") {
          }
          if (content.eventType === "ERROR") {
            // Usually this will be a context exceeded error.
            // By removing the last AI and tool messages we remove
            // the function call result that is exceeding the context.
            const { messages } = copilot.getCurrentChat();
            const timestamps = getLatestAiToolPairTimestamps(messages);
            if (timestamps) copilot.removeMessages(timestamps);
          }
          copilot.addMessage({
            role: "system",
            content: content,
            copilotId,
            orchestrationModeEnabled:
              useCopilotStore.getState().orchestrationModeEnabled,
            timestamp: Date.now() + 1, // adding 1 to avoid timestamp collision with the human message
          });
          break;
        }
        case "copilotMessageArtifact": {
          const artifact = data as ArtifactT;
          const suffix = aiMessageBuffer.endsWith("| ") ? "\n" : "";
          const artifactMarker = `${suffix}<artifact className="${artifact.name}"/>`;
          aiMessageBuffer += artifactMarker;
          copilot.addArtifactToCurrentChat(artifact);
          setStreamedData((prevData) => prevData + artifactMarker);
          if (artifact.type === "app") void autoOpenAppArtifact(artifact);

          break;
        }
        case "copilotMessageChunk": {
          const delta = (data as { delta?: string }).delta;
          if (!delta) break;
          aiMessageBuffer += delta;
          setStreamedData((prevData) => prevData + delta);
          break;
        }
        case "copilotCitationCollection": {
          const { citations } = data as { citations: CitationT[] };
          let citationMarkers = citations
            .map((citation) => `<citation className="${citation.id}"/>`)
            .join("");

          if (citationMarkers && aiMessageBuffer.endsWith("| "))
            citationMarkers = `\n${citationMarkers}`;

          aiMessageBuffer += citationMarkers;
          setStreamedData((prevData) => prevData + citationMarkers);

          setStreamedCitations((prevData) => {
            return [...prevData, ...citations];
          });

          citationBuffer.push(...citations);
          break;
        }
        case "copilotFunctionCall": {
          flushBuffers();
          const functionCallSpec = functionCallSchema.parse(data) as FunctionCallT;
          await handleFunctionCall({
            functionCallSpec,
            incomingMessage: question,
            abortSignal,
            xHeaders,
            targetAgent,
          });
          break;
        }
        case "copilotPromptSuggestions": {
          const suggestions = (data as { suggestions?: unknown } | undefined)
            ?.suggestions;
          if (Array.isArray(suggestions) && suggestions.length > 0) {
            // They belong to the answer: with it when it is put in the chat, else to the last message.
            if (aiMessageBuffer) pendingSuggestionsRef.current = suggestions;
            else copilot.updateLastMessage({ suggestions });
          }
          break;
        }
        case "done": {
          if (!keepAlive)
            dispatch(
              { ...ResetState, ...StreamingStatus.READY },
              setStreamedData,
              setStreamedCitations,
            );
          const updateMessage = {} as Partial<AIMessage>;

          // Merge any pending MCP citations into the buffer and append markers
          const pending = pendingMcpCitationsRef.current;
          if (pending.length) {
            const idsInContent = new Set(
              Array.from(
                (aiMessageBuffer || "").matchAll(/<citation className="([^"]+)"\/>/g),
              ).map((m) => m[1]),
            );
            const newMarkers = pending
              .filter((c) => !idsInContent.has(c.id))
              .map((c) => `<citation className="${c.id}"/>`)
              .join("");

            if (newMarkers) {
              aiMessageBuffer +=
                (aiMessageBuffer?.endsWith("| ") ? "\n" : "") + newMarkers;
            }
            // Merge into citationBuffer with deduplication
            const bufferIds = new Set(citationBuffer.map((c) => c.id));
            for (const c of pending) if (!bufferIds.has(c.id)) citationBuffer.push(c);
            // Clear accumulated pending citations
            pendingMcpCitationsRef.current = [];
          }

          if (copilot.selectedCopilot.id === "default-copilot") {
            for (const key of ["traceId", "completionId"] as const) {
              const value = xHeaders[key];
              if (value) updateMessage[key] = value;
            }
          }

          if (aiMessageBuffer) {
            // The answer is put in the chat whole, with what belongs to it.
            commitAnswer(updateMessage);
            // Only update title if there is actual AI message content
            // Title generation is a FINOS Workspace backend feature available for all agents
            if (aiEnhancements && aiCopilotAiEnhancementsFF) {
              updateCopilotTitle(xHeaders?.traceId || "");
            }
          } else if (Object.keys(updateMessage).length > 0) {
            copilot.updateLastMessage(updateMessage);
          }

          // The cursor goes back to the question box once the answer is in the chat. The wait is for
          // the chat to have rendered it. Kept so it can be cancelled: a timer that nobody owns runs
          // after the component is gone, and then there is no document to look in — which is what
          // ended the unit tests when a stream finished within 100 ms of the test file finishing.
          clearTimeout(focusInputRef.current);
          focusInputRef.current = setTimeout(() => {
            document.getElementById("copilot-input")?.focus();
          }, 100);
          break;
        }
        default:
          console.warn("Unknown event type:", event);
      }
      return {
        accumulatedMessageData: aiMessageBuffer,
        accumulatedCitations: citationBuffer,
      };
    },
    [
      copilot,
      handleFunctionCall,
      updateCopilotTitle,
      aiEnhancements,
      commandRef,
      autoOpenAppArtifact,
      pendingMcpCitationsRef,
      pendingSuggestionsRef,
    ],
  );

  useEffect(() => {
    handleEventRef.current = handleEvent;
  }, [handleEvent]);

  // Nothing to focus once this is unmounted, and the page it would look in may be gone.
  useEffect(() => () => clearTimeout(focusInputRef.current), []);

  const startStreamCb = useCallback(
    async (params: CopilotSubmitParams): Promise<void> => {
      const { question, addHumanMessage = true, mockResponse } = params;
      const selectedCopilot = copilot.selectedCopilot;
      if (!selectedCopilot) return;
      copilot.setIsTyping(false);

      const { sent, hasPending } = partitionFilesOnSend(
        useStreamingStore.getState().files,
      );
      if (hasPending) {
        toast.info("Wait for the file upload to finish");
        return;
      }

      // Attached files move onto the message they are sent with.
      const sentFiles = addHumanMessage ? sent : [];
      const clearSentFiles = sentFiles.length
        ? {
            files: (prev: CopilotFile[]) =>
              prev.filter((file) => file.status === "failed"),
          }
        : {};

      if (mockResponse) {
        // Add the human message if needed
        if (addHumanMessage) {
          copilot.addMessage({
            role: "human",
            content: question || commandRef.current,
            copilotId: selectedCopilot.id,
            timestamp: Date.now(),
            ...(sentFiles.length ? { files: sentFiles } : {}),
          });
        }

        let content =
          typeof mockResponse === "string" ? mockResponse : mockResponse.messageContent;

        // Add the artifact if it exists
        if (typeof mockResponse === "object" && mockResponse.artifact) {
          copilot.addArtifactToCurrentChat(mockResponse.artifact);
          // Add artifact marker to content
          const artifactName = mockResponse.artifact.name || mockResponse.artifact.uuid;
          const artifactMarker = `<artifact className="${artifactName}"/>`;
          content = `${content}\n${artifactMarker}`;
        }

        // Add the mock AI response
        copilot.addMessage({
          role: "ai",
          content: content,
          copilotId: selectedCopilot.id,
          timestamp: Date.now() + 1,
          citations:
            typeof mockResponse === "object" ? mockResponse.citations : undefined,
        });

        // Reset state
        dispatch(
          { ...ResetState, ...StreamingStatus.NOT_STARTED, ...clearSentFiles },
          setStreamedData,
          setStreamedCitations,
        );
        dispatchCopilotCommand("");

        // Resolve the promise for mock responses
        if (resolveStreamRef.current) {
          resolveStreamRef.current();
          resolveStreamRef.current = null;
        }

        return;
      }

      if (queriesLeft === 0) {
        dispatch({ limitReached: true });
        return;
      }

      if (streamingStatus === "streaming-ready") {
        // Ensure that previous requests are aborted and state is reset
        const newState = { ...ResetState } as Partial<StreamingState>;
        if (abortController) {
          abortController.abort();
          newState.abortController = null;
        }
        dispatch(newState, setStreamedData, setStreamedCitations);
      }
      if (streamingStatus === "streaming-stopped") return stopSubmit();

      const incomingMessage = question || commandRef.current;

      if (addHumanMessage)
        copilot.addMessage({
          role: "human" as const,
          content: incomingMessage,
          copilotId: selectedCopilot.id,
          timestamp: Date.now(),
          ...(sentFiles.length ? { files: sentFiles } : {}),
        });

      const newAbortController = new AbortController();

      pendingSuggestionsRef.current = null;

      // Clear previous data
      dispatch(
        {
          ...ResetState,
          loading: true,
          abortController: newAbortController,
          ...clearSentFiles,
        },
        setStreamedData,
        setStreamedCitations,
      );
      dispatchCopilotCommand("");

      const { queryUrl, init } = await getQueryFetchParams({
        // Reverse non-breaking space/hyphen from message
        incomingMessage: incomingMessage
          .replace(/\u00A0/g, " ")
          .replace(/\u2011/g, "-"),
        abortSignal: newAbortController.signal,
      });
      const response = await fetchAgent(queryUrl, init);
      if (!response.ok) {
        const errBody = await response.text().catch(() => "");
        console.error(`[copilot] ${response.status} ${queryUrl}:`, errBody);
        throw new Error(response.statusText);
      }

      const traceId = response.headers.get("X-Trace-Id") || "";
      const completionId = response.headers.get("X-Completion-ID") || "";
      const xHeaders = { traceId, completionId };
      const reader = response.body?.getReader();
      if (!isReadableStream(reader)) throw new Error("Response body is not readable");
      return await processStream(
        xHeaders,
        reader,
        newAbortController.signal,
        incomingMessage,
      );
    },
    [
      commandRef,
      resolveStreamRef,
      processStream,
      copilot,
      limitReached,
      streamingStatus,
      abortController,
      getQueryFetchParams,
      dispatch,
      queriesLeft,
      stopSubmit,
      setStreamedData,
      setStreamedCitations,
    ],
  );

  const { mutateAsync } = useMutation<void, Error, CopilotSubmitParams>({
    mutationFn: startStreamCb,
    onSuccess: (_data, _question) => {},
    onError: (error) => throwError(error),
  });

  const throwError = useCallback(
    (error: unknown) => {
      const err = typeof error === "string" ? new Error(error) : error;
      if (err instanceof Error && err.name === "AbortError") {
        // Ignore errors related to user aborting the request
        return;
      }
      console.error("Error:", err);
      copilot.updateLastMessageError(true);
      dispatch(
        { loading: false, ...StreamingStatus.READY },
        setStreamedData,
        setStreamedCitations,
      );
      dispatchCopilotCommand("");
    },
    [copilot.updateLastMessageError, dispatch, setStreamedData, setStreamedCitations],
  );

  const startStreamRef = useRef(mutateAsync);

  useEffect(() => {
    startStreamRef.current = mutateAsync;
  }, [mutateAsync]);

  const handleSubmit = useCallback(
    async ({ question, addHumanMessage, mockResponse }: CopilotSubmitParams = {}) => {
      // makes sure all widgets are visible before sending the question
      // otherwise dashboard data might be incomplete
      useThemeStore.getState().setPendingExport(true);

      // Create a promise that resolves when streaming is complete
      const streamComplete = new Promise<void>((resolve) => {
        resolveStreamRef.current = resolve;
      });

      await startStreamRef.current({ question, addHumanMessage, mockResponse });
      useThemeStore.getState().setPendingExport(false);

      return streamComplete;
    },
    [startStreamRef, resolveStreamRef],
  );

  return handleSubmit;
}

export function useHandleStreaming() {
  useStreamingHooks();
  const { handleSubmitRef, stopSubmitRef } = useCopilotContext();

  const { abortController, dispatch } = useShallowStreamingStore((s) => ({
    abortController: s.abortController,
    dispatch: s.dispatch,
  }));

  const [streamedData, setStreamedData] = useLocalStorage("streamedData", "");
  const [streamedCitations, setStreamedCitations] = useLocalStorage<CitationT[]>(
    "streamedCitations",
    [],
  );

  const { updateLastMessage } = useShallowCopilotStore((s) => ({
    updateLastMessage: s.updateLastMessage,
  }));

  const stopSubmit = useCallbackRef(() => {
    const newState: Partial<StreamingData> = { ...ResetState };
    if (abortController) {
      abortController.abort();
      newState.abortController = null;
    }

    const { selectedCopilot, addMessage, getCurrentChat } = useCopilotStore.getState();

    const { messages } = getCurrentChat();
    const lastMessage = messages[messages.length - 1];

    if (streamedData && selectedCopilot) {
      // Case 1: Text was received and is not in the chat yet (it is put there whole when it is complete):
      // add what there is as a cancelled AI message
      const newMessage: AIMessage = {
        role: "ai",
        content: streamedData,
        isCancelled: true,
        copilotId: selectedCopilot.id,
        timestamp: Date.now() + 1,
      };
      // Include citations if they exist
      if (streamedCitations && streamedCitations.length > 0) {
        newMessage.citations = streamedCitations;
      }
      addMessage(newMessage);
    } else if (lastMessage && lastMessage.role === "ai") {
      // Case 2: AI message exists and nothing is held - mark as cancelled
      const updateData: Partial<AIMessage> = { isCancelled: true };
      // Still include citations if they exist in localStorage
      if (streamedCitations && streamedCitations.length > 0) {
        updateData.citations = streamedCitations;
      }
      updateLastMessage(updateData);
    } else if (selectedCopilot) {
      // Case 3: No AI message exists yet, only system messages - create cancelled AI message
      const newMessage: AIMessage = {
        role: "ai",
        content: "",
        isCancelled: true,
        copilotId: selectedCopilot.id,
        timestamp: Date.now() + 1,
      };
      // Include citations if they exist
      if (streamedCitations && streamedCitations.length > 0) {
        newMessage.citations = streamedCitations;
      }
      addMessage(newMessage);
    }

    dispatch(newState, setStreamedData, setStreamedCitations);

    dispatchCopilotCommand("");
  });

  const handleSubmit = useStreamResponse(stopSubmit);

  useEffect(() => {
    handleSubmitRef.current = handleSubmit;
    stopSubmitRef.current = stopSubmit;
    const ctrl = new AbortController();

    function dispatchedSubmit(e: CustomEvent<CopilotSubmitParams | undefined>) {
      handleSubmit(e.detail);
    }
    window.addEventListener("copilotSubmit", dispatchedSubmit, { signal: ctrl.signal });
    window.addEventListener("copilotStopSubmit", stopSubmit, { signal: ctrl.signal });
    return () => ctrl.abort();
  }, [handleSubmitRef, stopSubmitRef, handleSubmit, stopSubmit]);
}

export default useStreamResponse;

type HandleEventProps = {
  event: string;
  data?: unknown;
  question: string;
  accumulatedMessageData: string;
  accumulatedCitations: CitationT[];
  abortSignal: AbortSignal;
  xHeaders: XHeadersT;
  keepAlive?: boolean;
  targetAgent?: Copilot;
};

type HandleFunctionCallProps = {
  functionCallSpec: FunctionCallT;
  incomingMessage: string;
  abortSignal: AbortSignal;
  xHeaders: XHeadersT;
  targetAgent?: Copilot;
};

function isReadableStream<T>(obj: unknown): obj is ReadableStreamDefaultReader<T> {
  return !!obj && typeof (obj as { read?: unknown }).read === "function";
}

function getLatestAiToolPairTimestamps(messages: Message[]): number[] | null {
  const lastToolIndex = messages.findLastIndex((message) => message.role === "tool");
  const toolMessage = messages[lastToolIndex];
  const previousMessage = messages[lastToolIndex - 1];
  if (previousMessage?.role === "ai") {
    try {
      // Check if the ai message is a function call
      const content = JSON.parse(previousMessage.content);
      if (content.function) return [previousMessage.timestamp, toolMessage.timestamp];
    } catch (_) {
      return null;
    }
  }
  return null;
}
