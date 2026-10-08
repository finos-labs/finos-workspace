import { useCallback } from "react";
import { convertHeadersToRecord } from "~/lib/api";
import { useShallowAuthStore } from "~/lib/state/auth";
import { type Copilot, useShallowCopilotStore } from "~/lib/state/copilot";

export function useGetCopilotRequestHeaders() {
  const user = useShallowAuthStore((s) => s.user);
  const { selectedCopilot, getCurrentChat } = useShallowCopilotStore((s) => ({
    selectedCopilot: s.selectedCopilot,
    getCurrentChat: s.getCurrentChat,
  }));

  const getCopilotRequestHeaders = useCallback(
    (xTraceId?: string, targetAgent?: Copilot) => {
      // default-copilot is the only copilot without a holderUuid
      // If targetAgent is provided, use it; otherwise fall back to selectedCopilot
      const copilotToUse = targetAgent || selectedCopilot;
      const isDefaultCopilot = !copilotToUse?.holderUuid;
      const { uuid: chatId } = getCurrentChat();

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Trace-Id": xTraceId || chatId,
      };
      if (isDefaultCopilot) {
        headers.Authorization = `Bearer ${user?.token}`;
        if (user?.uuid) headers["X-User-Id"] = user.uuid;
      }

      const copilotHeaders = copilotToUse?.headers;

      const convertedHeaders = convertHeadersToRecord(copilotHeaders).headers;
      for (const [key, value] of Object.entries(convertedHeaders)) {
        if (value !== undefined) headers[key] = value;
      }

      return headers;
    },
    [
      selectedCopilot?.holderUuid,
      selectedCopilot?.headers,
      user?.token,
      user?.uuid,
      getCurrentChat,
    ],
  );
  return getCopilotRequestHeaders;
}
