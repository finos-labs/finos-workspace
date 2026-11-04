import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type CopilotKeysStatus,
  type CopilotKeysUpdate,
  getCopilotKeys,
  putCopilotKeys,
} from "~/api/user.api";
import { useShallowAuthStore } from "~/lib/state/auth";

const COPILOT_KEYS_QUERY_KEY = ["copilot-keys"];

const NO_KEYS: CopilotKeysStatus = { has_openai_key: false, has_perplexity_key: false };

export function useCopilotKeys(): CopilotKeysStatus {
  const signedIn = useShallowAuthStore((s) => s.user !== null);
  const { data } = useQuery({
    queryKey: COPILOT_KEYS_QUERY_KEY,
    queryFn: getCopilotKeys,
    enabled: signedIn,
    staleTime: Number.POSITIVE_INFINITY,
  });
  return data ?? NO_KEYS;
}

export function useSaveCopilotKeys() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (keys: CopilotKeysUpdate) => putCopilotKeys(keys),
    onSuccess: (status) => queryClient.setQueryData(COPILOT_KEYS_QUERY_KEY, status),
  });
}
