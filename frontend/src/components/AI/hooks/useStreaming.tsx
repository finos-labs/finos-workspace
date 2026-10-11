import isEqual from "lodash.isequal";
import { type Dispatch, useCallback, useEffect, useState } from "react";
import { useDebounce } from "use-debounce";
import { subscribeWithSelector } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import { createWithEqualityFn } from "zustand/traditional";
import { type DispatchAction, reducerAction } from "~/hooks/useStateReducer";
import { useCopilotContext } from "~/lib/contexts/CopilotChatContext";
import type { Selector } from "~/lib/state/app";

import type { Citation, CopilotFile } from "~/lib/state/copilot";

export type HandleSubmitParams = {
  question?: string;
  addHumanMessage?: boolean;
};

export interface StreamingData {
  streamingStatus: "streaming-ready" | "streaming-stopped";
  isDragging: boolean;
  loading: boolean;
  files: CopilotFile[];
  abortController: AbortController | null;
  allowDirectRetrievalFF: boolean;
  limitReached: boolean;
  completion: string;
  editMessageCompletion: string;
}

export interface StreamingState extends StreamingData {
  dispatch: (
    action: DispatchAction<StreamingData>,
    setStreamedData?: (value: string) => void,
    setStreamedCitations?: (value: Citation[]) => void,
  ) => void;
}
export const useStreamingStore = createWithEqualityFn<StreamingState>()(
  subscribeWithSelector((set, get) => ({
    streamingStatus: "streaming-ready",
    isDragging: false,
    loading: false,
    files: [],
    abortController: null,
    allowDirectRetrievalFF: true,
    limitReached: false,
    completion: "",
    editMessageCompletion: "",
    dispatch: (action, setStreamedData, setStreamedCitations) => {
      const { dispatch: _dispatch, ...state } = get();
      set(reducerAction<StreamingData>(state, action));
      if (setStreamedData) setStreamedData("");
      if (setStreamedCitations) setStreamedCitations([]);
    },
  })),
);

export function useShallowStreamingStore<T>(selector: Selector<StreamingState, T>): T {
  return useStreamingStore(useShallow(selector), (prev, next) => isEqual(prev, next));
}

export type DispatchActionType = Dispatch<DispatchAction<StreamingData>>;

export const StreamingStatus = {
  READY: { streamingStatus: "streaming-ready" },
  STOPPED: { streamingStatus: "streaming-stopped" },
} as { [key: string]: { streamingStatus: StreamingState["streamingStatus"] } };

export const ResetState = {
  loading: false,
  streamingStatus: "streaming-ready" as StreamingState["streamingStatus"],
};

export function useLocalCommand() {
  const commandRef = useCopilotContext()?.commandRef;
  const [command, setCommand] = useState(commandRef.current);

  useEffect(() => {
    function handleCopilotCommand(event: WindowEventMap["copilotCommand"]) {
      const { command } = event.detail || {};
      if (command !== undefined) setCommand(command);
    }

    window.addEventListener("copilotCommand", handleCopilotCommand);

    return () => {
      window.removeEventListener("copilotCommand", handleCopilotCommand);
    };
  }, [commandRef, setCommand]);

  return command;
}

export function useStreamingHooks() {
  const commandRef = useCopilotContext()?.commandRef;

  const handleCopilotCommand = useCallback(
    (event: WindowEventMap["copilotCommand"]) => {
      let command = event.detail?.command;

      if (typeof command === "function") command = command(commandRef.current ?? "");

      if (command !== undefined) commandRef.current = command;
    },
    [commandRef],
  );

  useEffect(() => {
    window.addEventListener("copilotCommand", handleCopilotCommand);

    return () => {
      window.removeEventListener("copilotCommand", handleCopilotCommand);
    };
  }, [handleCopilotCommand]);

  const [debouncedCommand] = useDebounce(commandRef.current, 500);

  // Use useEffect to save the 'command' field to local storage whenever it changes
  useEffect(() => {
    localStorage.setItem("command", debouncedCommand);
  }, [debouncedCommand]);
}
