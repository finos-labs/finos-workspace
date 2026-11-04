import { useMemo } from "react";
import { getDefaultCopilot } from "~/lib/constants";
import { getConfig } from "~/lib/runtimeConfig";
import {
  type Copilot,
  type ExternalCopilotHolder,
  useShallowCopilotStore,
} from "~/lib/state/copilot";

const aiCopilotDefaultCopilotFF = getConfig().copilot.defaultCopilot;

export function selectExternalCopilots(
  holders: ExternalCopilotHolder[] | undefined,
): Copilot[] {
  return (holders ?? [])
    .filter((holder) => holder.enabled !== false)
    .flatMap((holder) => holder.copilots ?? []);
}

export default function useGetAiAgents(): Copilot[] {
  const { externalCopilotHolders } = useShallowCopilotStore((copilot) => ({
    externalCopilotHolders: copilot.externalCopilotHolders,
  }));

  const aiAgentsMemo = useMemo(
    () => [
      ...(aiCopilotDefaultCopilotFF ? [getDefaultCopilot()] : []),
      ...selectExternalCopilots(externalCopilotHolders),
    ],
    [externalCopilotHolders, aiCopilotDefaultCopilotFF],
  );

  return aiAgentsMemo;
}
