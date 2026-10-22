import { useCallback } from "react";
import { convertHeadersToRecord } from "~/lib/api";
import { type Copilot, useShallowCopilotStore } from "~/lib/state/copilot";

/**
 * The headers of a request to an agent: the trace id, a custom agent's own configured
 * headers (looked up in page memory by its holder), and the identity headers the
 * deployment forwards. No Workspace credential is ever added here: a request to the
 * default Copilot gets its agent token from fetchAgent.
 */
export function useGetCopilotRequestHeaders() {
  const { selectedCopilot, getCurrentChat, externalCopilotHolders } =
    useShallowCopilotStore((s) => ({
      selectedCopilot: s.selectedCopilot,
      getCurrentChat: s.getCurrentChat,
      externalCopilotHolders: s.externalCopilotHolders,
    }));

  const getCopilotRequestHeaders = useCallback(
    (xTraceId?: string, targetAgent?: Copilot) => {
      // If targetAgent is provided, use it; otherwise fall back to selectedCopilot
      const copilotToUse = targetAgent || selectedCopilot;
      const { uuid: chatId } = getCurrentChat();

      // default-copilot is the only copilot without a holderUuid
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
