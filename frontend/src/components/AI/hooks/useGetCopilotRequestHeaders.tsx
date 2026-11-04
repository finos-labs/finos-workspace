import { useCallback } from "react";
import { useShallowCopilotStore } from "~/lib/state/copilot";

export function useGetCopilotRequestHeaders() {
  const getCurrentChat = useShallowCopilotStore((s) => s.getCurrentChat);

  return useCallback(
    (xTraceId?: string) => ({
      "Content-Type": "application/json",
      "X-Trace-Id": xTraceId || getCurrentChat().uuid,
    }),
    [getCurrentChat],
  );
}
