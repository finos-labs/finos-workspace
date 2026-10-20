import { useEffect, useMemo } from "react";
import { Button } from "~/components/ds/atoms/Button";
import { type Usage, useShallowAccessStore } from "~/lib/state/access";
import { useShallowCopilotStore } from "~/lib/state/copilot";
import { isAgentGranted, useCopilotAccessStore } from "~/lib/state/copilotAccess";
import { useShallowThemeStore } from "~/lib/state/theme";
import { useCopilotKeys } from "./useCopilotKeys";
import { useShallowStreamingStore } from "./useStreaming";

export default function useQueriesLeft(fromUsageInfo = false): {
  queriesLeft: number | null;
  usage: Partial<Usage> | null;
} {
  const { has_openai_key } = useCopilotKeys();
  const selectedCopilot = useShallowCopilotStore((s) => s.selectedCopilot);
  const usage = useShallowAccessStore((state) => state.usage);

  if (has_openai_key) return { queriesLeft: null, usage };

  // Only apply limits to the default copilot (Ada)
  // default-copilot is the only copilot without a holderUuid
  // A null limit is no limit; 0 allows nothing
  const callsLimit = usage?.copilot_calls_limit ?? null;
  const tokensLimit = usage?.copilot_tokens_limit ?? null;
  if (
    !usage ||
    (!fromUsageInfo && selectedCopilot?.holderUuid) ||
    (callsLimit === null && tokensLimit === null)
  )
    return { queriesLeft: null, usage: {} };

  // The token limit is checked before a query starts: once the day's tokens are used
  // up, no query is left
  const tokensUsedUp =
    tokensLimit !== null && (usage.number_copilot_tokens_day_count ?? 0) >= tokensLimit;

  return {
    queriesLeft: tokensUsedUp
      ? 0
      : callsLimit !== null
        ? Math.max(0, callsLimit - usage.number_copilot_calls_day_count)
        : null,
    usage,
  };
}

export function QueryLimitReached() {
  const { limitReached, dispatch } = useShallowStreamingStore((s) => ({
    limitReached: s.limitReached,
    dispatch: s.dispatch,
  }));

  const { queriesLeft, usage } = useQueriesLeft();
  const setApiKeyDialogOpen = useShallowThemeStore((s) => s.setApiKeyDialogOpen);
  const { showWelcome, selectedCopilot } = useShallowCopilotStore((s) => ({
    showWelcome: s.showWelcome,
    selectedCopilot: s.selectedCopilot,
  }));
  // A user whose roles grant nothing of the agent has no allowance either: say what is missing
  const granted = useCopilotAccessStore((s) =>
    isAgentGranted(s.access, selectedCopilot?.id ?? ""),
  );

  const messageMemo = useMemo(() => {
    if (!granted) {
      return (
        <div className="_message-content">
          <div className="bg-[#7F1D1D33] border border-[#EF4444] rounded px-2.5 py-1 space-y-1">
            <p className="text-[#DC2626] dark:text-[#EF4444] pt-1">
              <span className="text-medium font-bold">
                No role gives you the agent yet
              </span>
            </p>
            <p className="pt-1 pb-2 text-xs">Ask your admin.</p>
          </div>
        </div>
      );
    }
    const {
      copilot_calls_limit,
      number_copilot_calls_day_count = 0,
      copilot_tokens_limit,
      number_copilot_tokens_day_count = 0,
    } = usage ?? {};
    const tokensUsedUp =
      copilot_tokens_limit != null &&
      number_copilot_tokens_day_count >= copilot_tokens_limit;

    return (
      <div className="_message-content">
        <div className="bg-[#7F1D1D33] border border-[#EF4444] rounded px-2.5 py-1 space-y-1">
          <p className="text-[#DC2626] dark:text-[#EF4444] pt-1">
            <span className="text-medium font-bold">Daily Limit Reached </span>
            <span className="text-xs">
              {tokensUsedUp
                ? `- ${number_copilot_tokens_day_count} of ${copilot_tokens_limit} tokens used`
                : `- ${number_copilot_calls_day_count} of ${copilot_calls_limit} queries used`}
            </span>
          </p>
          <p className="pt-1 text-xs">
            You've reached your daily limit of Agent{" "}
            {tokensUsedUp ? "tokens" : "queries"}. Add your OpenAI key or return
            tomorrow.
          </p>
          <div className="py-2">
            <Button
              size="xs"
              variant="primary"
              onClick={() => setApiKeyDialogOpen(true)}
            >
              Add your OpenAI key
            </Button>
          </div>
        </div>
      </div>
    );
  }, [granted, usage, setApiKeyDialogOpen]);

  useEffect(() => {
    if (limitReached && queriesLeft !== 0) {
      dispatch({ limitReached: false });
    }
  }, [limitReached, queriesLeft]);

  if (!(limitReached && usage && queriesLeft === 0)) return null;

  if (showWelcome) {
    return (
      <div className="flex flex-col items-center justify-center grow w-full">
        <div className="max-w-[406px]">
          <div className="flex justify-center">{messageMemo}</div>
        </div>
      </div>
    );
  }

  return messageMemo;
}
