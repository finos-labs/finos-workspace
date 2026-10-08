import { useCallback, useMemo, useState } from "react";
import {
  ALL_AI_FEATURES,
  getAiApiUrl,
  getDefaultCopilot,
  MAX_COPILOT_LINKS,
} from "~/lib/constants";
import { useShallowAuthStore } from "~/lib/state/auth";
import type { CopilotContextItem } from "~/lib/state/copilot";
import { useShallowCopilotStore } from "~/lib/state/copilot";
import type { WidgetSubsetData } from "~/lib/state/copilotData";
import { useShallowCopilotDataStore } from "~/lib/state/copilotData";
import { useShallowMcpToolsStore } from "~/lib/state/mcpTools";
import { showNotification } from "~/lib/utils/toast";
import {
  computeExpandedWidgets,
  convertArtifactsToContextItems,
  extractUrls,
} from "./useAiFetchRequestInit";
import { useGetCopilotRequestHeaders } from "./useGetCopilotRequestHeaders";
import { useGetCustomApiKeys } from "./useGetCustomApiKeys";
import { useGetFinalMessagesAndWidgets } from "./useGetFinalMessagesAndWidgets";

export function useEnhancePrompt() {
  const [isEnhancing, setIsEnhancing] = useState(false);

  const userToken = useShallowAuthStore((s) => s.user?.token);
  const getCurrentChatArtifacts = useShallowCopilotStore(
    (s) => s.getCurrentChatArtifacts,
  );

  const {
    getCopilotWidgets,
    widgetSubsetData,
    extraWidgetsEnabled,
    generativeUiEnabled,
  } = useShallowCopilotDataStore((s) => ({
    widgetSubsetData: s.widgetSubsetData,
    extraWidgetsEnabled: s.extraWidgetsEnabled,
    generativeUiEnabled: s.generativeUiEnabled,
    getCopilotWidgets: s.getCopilotWidgets,
  }));

  const customFeatureStates = useShallowCopilotStore((s) => s.customFeatureStates);

  const getCopilotRequestHeaders = useGetCopilotRequestHeaders();
  const getCustomApiKeys = useGetCustomApiKeys();
  const getFinalMessagesAndWidgets = useGetFinalMessagesAndWidgets();
  const getEnabledToolsForAgent = useShallowMcpToolsStore(
    (s) => s.getEnabledToolsForAgent,
  );
  const getEnabledToolCount = useShallowMcpToolsStore((s) => s.getEnabledToolCount);

  // Get workspace options (including web search)
  // Always use getDefaultCopilot() features for prompt enhancement
  const workspaceOptions = useMemo(() => {
    const options: Record<string, boolean | string> = {};
    const features = getDefaultCopilot().features || {};

    // Built-in options controlled by UI toggles and agent capability
    if (features?.["widget-global-search"] && extraWidgetsEnabled)
      options["widget-global-search"] = true;
    if (features?.["generative-ui"] && generativeUiEnabled)
      options["generative-ui"] = true;
    if (features?.["mcp-tools"] && getEnabledToolCount() > 0)
      options["mcp-tools"] = true;

    // Custom features like workspace-web-search - respect UI toggle state
    for (const [key, val] of Object.entries(features)) {
      if (ALL_AI_FEATURES.has(key)) continue;
      if (val && typeof val === "object") {
        const featureType = val.type || "toggle";
        const stateVal = customFeatureStates[key];
        if (featureType === "text" || featureType === "select") {
          if (typeof stateVal === "string" && stateVal) {
            options[key] = stateVal;
          }
        } else if (stateVal) {
          options[key] = true;
        }
      } else if (val === true) {
        const isEnabledInUI = customFeatureStates[key];
        if (isEnabledInUI) {
          options[key] = true;
        }
      }
    }

    return options;
  }, [
    extraWidgetsEnabled,
    generativeUiEnabled,
    getEnabledToolCount,
    customFeatureStates,
  ]);

  const enhancePrompt = useCallback(
    async (promptText: string): Promise<string> => {
      if (!userToken) {
        throw new Error("User not authenticated");
      }

      setIsEnhancing(true);

      try {
        const { selectedWidgets, temporaryWidgets, allWidgets, workspaceState } =
          getCopilotWidgets();
        const customApiKeys = getCustomApiKeys();

        // Always use getDefaultCopilot() features for prompt enhancement
        const features = getDefaultCopilot().features;
        const extraWidgetsCap = Boolean(features?.["widget-global-search"]);
        const mcpToolsEnabled = Boolean(
          features?.["mcp-tools"] && getEnabledToolCount() > 0,
        );

        const { finalMessages, finalDashboardWidgets, mentionWidgets } =
          await getFinalMessagesAndWidgets();

        const { expandedPrimaryWidgets, expandedSecondaryWidgets, expandedAllWidgets } =
          computeExpandedWidgets(
            selectedWidgets,
            temporaryWidgets,
            allWidgets,
            mentionWidgets,
            finalDashboardWidgets,
          );

        // Check if there's sufficient context for prompt enhancement
        const hasWidgets =
          expandedPrimaryWidgets.length > 0 || expandedSecondaryWidgets.length > 0;
        const hasMcpTools = mcpToolsEnabled;
        const hasWebSearch = Boolean(workspaceOptions["workspace-web-search"]);

        if (!(hasWidgets || hasMcpTools || hasWebSearch)) {
          showNotification({
            message: "Not enough context for prompt suggestion",
            description:
              "Enable widgets, MCP tools, or web search to get prompt suggestions",
            toastType: "error",
          });
          return promptText;
        }

        const artifacts = getCurrentChatArtifacts();
        const contextArtifacts = convertArtifactsToContextItems(artifacts);
        const context: (CopilotContextItem | WidgetSubsetData)[] = [
          ...contextArtifacts,
          ...(widgetSubsetData || []),
        ];

        // Get enabled tools if MCP is enabled
        const enabledTools = mcpToolsEnabled ? await getEnabledToolsForAgent() : [];

        const payload = {
          widgets: {
            primary: expandedPrimaryWidgets,
            secondary: expandedSecondaryWidgets,
            extra: extraWidgetsEnabled && extraWidgetsCap ? expandedAllWidgets : [],
          },
          messages: [
            ...finalMessages,
            {
              role: "human",
              content: promptText,
            },
          ],
          context: context,
          urls: extractUrls(promptText, MAX_COPILOT_LINKS),
          api_keys: customApiKeys,
          workspace_state: workspaceState,
          workspace_options: workspaceOptions,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          tools: enabledTools,
        };

        const response = await fetch(`${getAiApiUrl()}/v1/enhance_prompt`, {
          method: "POST",
          headers: getCopilotRequestHeaders(undefined, getDefaultCopilot()),
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error(
            `Enhancement failed: ${response.status} ${response.statusText}`,
          );
        }

        let enhancedText = await response.text();

        // Strip surrounding quotes if present
        enhancedText = enhancedText.trim();
        if (
          (enhancedText.startsWith('"') && enhancedText.endsWith('"')) ||
          (enhancedText.startsWith("'") && enhancedText.endsWith("'"))
        ) {
          enhancedText = enhancedText.slice(1, -1);
        }

        return enhancedText;
      } finally {
        setIsEnhancing(false);
      }
    },
    [
      userToken,
      getCopilotWidgets,
      getCustomApiKeys,
      getFinalMessagesAndWidgets,
      getCurrentChatArtifacts,
      widgetSubsetData,
      extraWidgetsEnabled,
      generativeUiEnabled,
      getCopilotRequestHeaders,
      workspaceOptions,
      getEnabledToolsForAgent,
      getEnabledToolCount,
    ],
  );

  return { enhancePrompt, isEnhancing };
}
