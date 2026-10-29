import { useCallback } from "react";
import { convertHeadersToRecord } from "~/lib/api";
import { type Copilot, useShallowCopilotStore } from "~/lib/state/copilot";

export function useGetCopilotRequestHeaders() {
  const { selectedCopilot, getCurrentChat, externalCopilotHolders } =
    useShallowCopilotStore((s) => ({
      selectedCopilot: s.selectedCopilot,
      getCurrentChat: s.getCurrentChat,
      externalCopilotHolders: s.externalCopilotHolders,
    }));

  const getCopilotRequestHeaders = useCallback(
    (xTraceId?: string, targetAgent?: Copilot) => {
      const copilotToUse = targetAgent || selectedCopilot;
      const { uuid: chatId } = getCurrentChat();

      const holder = copilotToUse?.holderUuid
        ? externalCopilotHolders.find((h) => h.uuid === copilotToUse.holderUuid)
        : undefined;

      return {
        ...convertHeadersToRecord(holder?.headers).headers,
        "Content-Type": "application/json",
        "X-Trace-Id": xTraceId || chatId,
      };
    },
    [selectedCopilot, externalCopilotHolders, getCurrentChat],
  );
  return getCopilotRequestHeaders;
}
