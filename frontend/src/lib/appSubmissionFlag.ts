import { getConfig } from "~/lib/runtimeConfig";
import { useShallowFeatureFlagsStore } from "~/lib/state/featureFlags";

/**
 * Gates the developer marketplace submission flow (List app -> fill listing ->
 * run tests -> submit for review). Runtime per-user capability sourced from the
 * `can_submit_marketplace` flag on the login / validate-and-sync payload (superuser
 * or whitelisted), so a mid-session whitelist toggle surfaces on the next sync
 * without a relogin. A deployment that lists apps from a remote marketplace
 * (`urls.marketplace`) never exposes the flow: submissions would land in its own
 * backend, not in the marketplace it lists.
 */
export function useCanSubmitApp(): boolean {
  const canSubmit = useShallowFeatureFlagsStore(
    (state) => state.featureFlags?.can_submit_marketplace ?? false,
  );
  return canSubmit && !getConfig().urls.marketplace;
}
