import { getConfig } from "~/lib/runtimeConfig";
import { useCopilotStore } from "~/lib/state/copilot";
import useGetAiAgents, { selectExternalCopilots } from "./useGetAiAgents";

/**
 * Copilot is "available" only when it is enabled AND at least one usable agent
 * exists. Without the default copilot (defaultCopilot off) that means a custom agent
 * has been connected; with it the default copilot keeps the count >= 1. Used to hide
 * every Copilot entry point until an agent is present.
 *
 * Reactive — for components/hooks.
 */
export function useCopilotAvailable(): boolean {
  const agents = useGetAiAgents();
  return getConfig().copilot.enabled && agents.length > 0;
}

/** Imperative variant for event handlers / non-hook utils (reads current store state). */
export function isCopilotAvailable(): boolean {
  if (!getConfig().copilot.enabled) return false;
  const builtIn = getConfig().copilot.defaultCopilot ? 1 : 0;
  const custom = selectExternalCopilots(
    useCopilotStore.getState().externalCopilotHolders,
  ).length;
  return builtIn + custom > 0;
}
