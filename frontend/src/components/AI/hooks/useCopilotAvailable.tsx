import { getConfig } from "~/lib/runtimeConfig";
import { useCopilotStore } from "~/lib/state/copilot";
import useGetAiAgents, { selectExternalCopilots } from "./useGetAiAgents";

export function useCopilotAvailable(): boolean {
  const agents = useGetAiAgents();
  return getConfig().copilot.enabled && agents.length > 0;
}

export function isCopilotAvailable(): boolean {
  if (!getConfig().copilot.enabled) return false;
  const builtIn = getConfig().copilot.defaultCopilot ? 1 : 0;
  const custom = selectExternalCopilots(
    useCopilotStore.getState().externalCopilotHolders,
  ).length;
  return builtIn + custom > 0;
}
