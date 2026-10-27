import { useCallback, useMemo } from "react";
import { useParams } from "react-router-dom";
import type { WidgetId } from "~/components/Widgets";
import {
  ALL_AI_FEATURES,
  getAiApiUrl,
  getDefaultCopilot,
  MAX_COPILOT_LINKS,
} from "~/lib/constants";
import {
  type ArtifactT,
  type Copilot,
  type CopilotContextItem,
  type CopilotWidget,
  type CopilotWidgets,
  type Message,
  MODEL_SETTING,
  modelSettingModels,
  useShallowCopilotStore,
} from "~/lib/state/copilot";
import { getCopilotAccess, selectModelId } from "~/lib/state/copilotAccess";
import { useShallowCopilotDataStore } from "~/lib/state/copilotData";
import {
  type AgentToolConfig,
  useMcpToolsStore,
  useShallowMcpToolsStore,
} from "~/lib/state/mcpTools";
import { useShallowSkillsLibraryStore } from "~/lib/state/skillsLibrary";
import { extractUrlsFromText } from "~/lib/utils";
import { withMcpLinks } from "~/lib/utils/mcpLink";
import type { DashboardInfoT } from "~/lib/utils/workspaceDashboard";
import type { SkillCatalogEntry, SkillPayload } from "~/types/auth.type";
import { useGetWidgetsStore } from "./useGetAppWidgets";
import { useGetCopilotRequestHeaders } from "./useGetCopilotRequestHeaders";
import { useGetFinalMessagesAndWidgets } from "./useGetFinalMessagesAndWidgets";

const featureFlagMapping = {
  extraWidgetsEnabled: "widget-global-search",
  orchestrationModeEnabled: "agent-orchestration",
  mcpToolsEnabled: "mcp-tools",
} as const;

const getEnabledFeatures = (features: Copilot["features"] | undefined) => {
  const featuresEnabled = Object.fromEntries(
    Object.entries(featureFlagMapping).map(([key, flag]) => [
      key,
      features?.[flag] === true,
    ]),
  ) as Partial<Record<keyof typeof featureFlagMapping, boolean>>;

  return featuresEnabled;
};

const withGrantedModelSetting = (
  options: Record<string, boolean | string>,
  agent: Copilot | null | undefined,
) => {
  const models = modelSettingModels(agent);
  if (!agent?.id || !models.length) return options;
  const picked = options[MODEL_SETTING];
  const modelId = selectModelId(
    getCopilotAccess(),
    agent.id,
    models,
    typeof picked === "string" ? picked : undefined,
  );
  return modelId ? { ...options, [MODEL_SETTING]: modelId } : options;
};

function parseSkillSlashCommands(message: string) {
  const regex = /\/skill:([a-z0-9]+(?:-[a-z0-9]+)*)\b/gi;
  const slugs = new Set<string>();
  let cleanedMessage = message;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(message)) !== null) {
    const slug = match[1].toLowerCase();
    slugs.add(slug);
    cleanedMessage = cleanedMessage.replace(match[0], " ").replace(/\s+/g, " ").trim();
  }
  return { slugs: Array.from(slugs), cleanedMessage };
}

export function useAiFetchRequestInit() {
  const { id: currentDashboardId } = useParams();

  const getEnabledToolsForAgent = useShallowMcpToolsStore(
    (s) => s.getEnabledToolsForAgent,
  );
  const getEnabledToolCount = useShallowMcpToolsStore((s) => s.getEnabledToolCount);

  const { getSkillsCatalog, getSkillBySlug, skills } = useShallowSkillsLibraryStore(
    (s) => ({
      getSkillsCatalog: s.getSkillsCatalog,
      getSkillBySlug: s.getSkillBySlug,
      skills: s.skills,
    }),
  );

  const {
    selectedCopilot,
    getCurrentChat,
    getCurrentChatArtifacts,
    orchestrationModeEnabled,
    customFeatureStates,
    getSelectedModelForAgent,
  } = useShallowCopilotStore((s) => ({
    selectedCopilot: s.selectedCopilot,
    getCurrentChat: s.getCurrentChat,
    getCurrentChatArtifacts: s.getCurrentChatArtifacts,
    customFeatureStates: s.customFeatureStates,
    orchestrationModeEnabled: s.orchestrationModeEnabled,
    getSelectedModelForAgent: s.getSelectedModelForAgent,
  }));

  const { getCopilotWidgets, widgetSubsetData, copilotWidgetsLastUpdated } =
    useShallowCopilotDataStore((s) => ({
      widgetSubsetData: s.widgetSubsetData,
      getCopilotWidgets: s.getCopilotWidgets,
      copilotWidgetsLastUpdated: s.copilotWidgetsLastUpdated,
    }));

  const workspaceOptions = useMemo(() => {
    const options: Record<string, boolean | string> = {};
    const features = selectedCopilot?.features || {};
    const EXCLUDE = ALL_AI_FEATURES;

    if (features?.["widget-global-search"]) options["widget-global-search"] = true;

    if (features?.["agent-orchestration"] && orchestrationModeEnabled)
      options["agent-orchestration"] = true;

    if (features?.["mcp-tools"] && getEnabledToolCount() > 0)
      options["mcp-tools"] = true;

    for (const [key, val] of Object.entries(features)) {
      if (EXCLUDE.has(key)) continue;
      if (val && typeof val === "object") {
        const featureType = val.type || "toggle";
        const stateVal = customFeatureStates?.[key];
        if (featureType === "text" || featureType === "select") {
          if (typeof stateVal === "string" && stateVal) {
            options[key] = stateVal;
          }
        } else if (stateVal) {
          options[key] = true;
        }
      } else if (val === true) {
        options[key] = true;
      }
    }

    return options;
  }, [
    selectedCopilot?.features,
    customFeatureStates,
    orchestrationModeEnabled,
    getEnabledToolCount,
  ]);

  const getCopilotRequestHeaders = useGetCopilotRequestHeaders();
  const getFinalMessagesAndWidgets = useGetFinalMessagesAndWidgets();

  const getQueryFetchParams = useCallback(
    async (
      props: GetQueryFetchParamsProps,
    ): Promise<{ queryUrl: string; init: RequestInit }> => {
      const { incomingMessage, abortSignal, targetAgent } = props;
      const { selectedWidgets, temporaryWidgets, allWidgets, workspaceState } =
        getCopilotWidgets(targetAgent);

      const features = targetAgent?.features || selectedCopilot?.features;
      const {
        extraWidgetsEnabled: extraWidgetsCap,
        orchestrationModeEnabled: orchestrationModeCap,
        mcpToolsEnabled,
      } = getEnabledFeatures(features);

      const { uuid: chatId } = getCurrentChat();

      const artifacts = getCurrentChatArtifacts();
      const contextArtifacts = convertArtifactsToContextItems(artifacts);
      const { finalMessages, finalDashboardWidgets, mentionWidgets } =
        await getFinalMessagesAndWidgets(targetAgent);

      const { expandedPrimaryWidgets, expandedSecondaryWidgets, expandedAllWidgets } =
        computeExpandedWidgets(
          selectedWidgets,
          temporaryWidgets,
          allWidgets,
          mentionWidgets,
          finalDashboardWidgets,
        );

      const context = [
        ...contextArtifacts,
        ...(widgetSubsetData || []),
      ] as CopilotContextItem[];

      const enabledTools = await getEnabledToolsForAgent();

      const finalWorkspaceState = { ...(workspaceState || {}) } as WorkspaceStateT;

      if (!(orchestrationModeEnabled && orchestrationModeCap))
        finalWorkspaceState.agents = undefined;

      const skillsCatalog = getSkillsCatalog();
      const { slugs: forcedSkillSlugs } = parseSkillSlashCommands(incomingMessage);
      const selectedSkills: SkillPayload[] = [];

      const agentSkills = (targetAgent ?? selectedCopilot)?.skills ?? [];
      for (const slug of forcedSkillSlugs) {
        const skill = getSkillBySlug(slug);
        if (skill) {
          selectedSkills.push({
            slug: skill.slug,
            description: skill.description,
            contentMarkdown: skill.content,
            source: "forced_slash",
          });
          continue;
        }
        const agentSkill = agentSkills.find((s) => s.slug === slug);
        if (agentSkill) {
          selectedSkills.push({
            slug,
            description: agentSkill.description,
            source: "forced_slash",
          });
        }
      }

      const agentForModel = targetAgent ?? selectedCopilot;
      const agentModels = agentForModel?.models;
      const selectedModelId =
        agentForModel?.id && agentModels?.length
          ? selectModelId(
              getCopilotAccess(),
              agentForModel.id,
              agentModels,
              getSelectedModelForAgent(agentForModel.id),
            )
          : undefined;

      const payload: HumanQueryPayload = {
        model: selectedModelId,
        widgets: linkRows(
          {
            primary: expandedPrimaryWidgets,
            secondary: expandedSecondaryWidgets,
            extra: extraWidgetsCap ? expandedAllWidgets : [],
          },
          mcpToolsEnabled ? enabledTools : [],
        ),
        messages: finalMessages,
        context: context,
        urls: extractUrls(incomingMessage, MAX_COPILOT_LINKS),
        workspace_state: finalWorkspaceState,
        workspace_options: Object.fromEntries(
          Object.entries(
            withGrantedModelSetting(workspaceOptions, agentForModel),
          ).filter(
            ([flag]) =>
              (!targetAgent && flag === "agent-orchestration") || features?.[flag],
          ),
        ),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        tools: mcpToolsEnabled ? enabledTools : [],
        skills_catalog: skillsCatalog.length > 0 ? skillsCatalog : undefined,
        selected_skills: selectedSkills.length > 0 ? selectedSkills : undefined,
      };

      console.debug(
        "[copilot-debug] mcpToolsEnabled:",
        mcpToolsEnabled,
        "tools:",
        enabledTools?.length,
        "workspace_options:",
        payload.workspace_options,
      );

      const queryUrl =
        targetAgent?.endpoints?.query || selectedCopilot?.endpoints?.query;
      if (!queryUrl) throw new Error("The selected agent has no query endpoint.");

      return {
        queryUrl,
        init: {
          method: "POST",
          signal: abortSignal,
          headers: getCopilotRequestHeaders(undefined, targetAgent),
          body: JSON.stringify(payload),
        },
      };
    },
    [
      workspaceOptions,
      selectedCopilot,
      getCopilotRequestHeaders,
      getCopilotWidgets,
      widgetSubsetData,
      customFeatureStates,
      getSelectedModelForAgent,
      getFinalMessagesAndWidgets,
      getEnabledToolsForAgent,
      copilotWidgetsLastUpdated,
      getCurrentChatArtifacts,
      getSkillsCatalog,
      getSkillBySlug,
      skills,
    ],
  );

  const getFunctionCallFetchParams = useCallback(
    async (
      props: GetFunctionCallFetchParamsProps,
    ): Promise<{ queryUrl: string; init: RequestInit }> => {
      const { xHeaders, abortSignal, targetAgent } = props;
      const { selectedWidgets, temporaryWidgets, allWidgets, workspaceState } =
        getCopilotWidgets(targetAgent);

      const features = targetAgent?.features || selectedCopilot?.features;
      const {
        extraWidgetsEnabled: extraWidgetsCap,
        mcpToolsEnabled,
        orchestrationModeEnabled: orchestrationModeCap,
      } = getEnabledFeatures(features);

      const enabledTools = await getEnabledToolsForAgent();

      const artifacts = getCurrentChatArtifacts();
      const contextArtifacts = convertArtifactsToContextItems(artifacts);
      const { finalMessages, finalDashboardWidgets, mentionWidgets } =
        await getFinalMessagesAndWidgets(targetAgent);

      const { expandedPrimaryWidgets, expandedSecondaryWidgets, expandedAllWidgets } =
        computeExpandedWidgets(
          selectedWidgets,
          temporaryWidgets,
          allWidgets,
          mentionWidgets,
          finalDashboardWidgets,
        );

      const context = [
        ...contextArtifacts,
        ...(widgetSubsetData || []),
      ] as CopilotContextItem[];

      const finalWorkspaceState = { ...(workspaceState || {}) } as WorkspaceStateT;

      if (!(orchestrationModeEnabled && orchestrationModeCap))
        finalWorkspaceState.agents = undefined;

      const skillsCatalog = getSkillsCatalog();
      const agentForModel = targetAgent ?? selectedCopilot;
      const agentModels = agentForModel?.models;
      const selectedModelId =
        agentForModel?.id && agentModels?.length
          ? selectModelId(
              getCopilotAccess(),
              agentForModel.id,
              agentModels,
              getSelectedModelForAgent(agentForModel.id),
            )
          : undefined;

      const payload: FunctionCallPayload = {
        model: selectedModelId,
        widgets: linkRows(
          {
            primary: expandedPrimaryWidgets,
            secondary: expandedSecondaryWidgets,
            extra: extraWidgetsCap ? expandedAllWidgets : [],
          },
          mcpToolsEnabled ? enabledTools : [],
        ),
        messages: finalMessages,
        context: context,
        workspace_state: finalWorkspaceState,
        workspace_options: Object.fromEntries(
          Object.entries(
            withGrantedModelSetting(workspaceOptions, agentForModel),
          ).filter(
            ([flag]) =>
              (!targetAgent && flag === "agent-orchestration") || features?.[flag],
          ),
        ),
        tools: mcpToolsEnabled ? enabledTools : [],
        skills_catalog: skillsCatalog.length > 0 ? skillsCatalog : undefined,
      };

      const queryUrl =
        targetAgent?.endpoints?.query || selectedCopilot?.endpoints?.query;
      if (!queryUrl) throw new Error("The selected agent has no query endpoint.");

      return {
        queryUrl,
        init: {
          method: "POST",
          signal: abortSignal,
          headers: getCopilotRequestHeaders(xHeaders?.traceId, targetAgent),
          body: JSON.stringify(payload),
        },
      };
    },
    [
      getCurrentChatArtifacts,
      selectedCopilot,
      getEnabledToolsForAgent,
      getCopilotWidgets,
      getCopilotRequestHeaders,
      widgetSubsetData,
      workspaceOptions,
      getSelectedModelForAgent,
      getFinalMessagesAndWidgets,
      copilotWidgetsLastUpdated,
      orchestrationModeEnabled,
      getSkillsCatalog,
      skills,
    ],
  );

  const getUpdateCopilotTitleFetchParams = useCallback(
    async (
      props: GetUpdateCopilotTitleFetchParamsProps,
    ): Promise<{ url: string; init: RequestInit }> => {
      const { xTraceId } = props;
      const { finalMessages } = await getFinalMessagesAndWidgets();

      const payload: UpdateTitlePayload = {
        messages: finalMessages,
      };
      return {
        url: `${getAiApiUrl()}/v1/generate/chat/title`,
        init: {
          method: "POST",
          headers: getCopilotRequestHeaders(xTraceId, getDefaultCopilot()),
          body: JSON.stringify(payload),
        },
      };
    },
    [getFinalMessagesAndWidgets, getCopilotRequestHeaders, currentDashboardId],
  );

  return [
    getQueryFetchParams,
    getFunctionCallFetchParams,
    getUpdateCopilotTitleFetchParams,
  ] as const;
}

export const computeExpandedWidgets = (
  selectedWidgets: CopilotWidget[],
  temporaryWidgets: CopilotWidget[],
  allWidgets: CopilotWidget[],
  mentionWidgets: CopilotWidget[],
  finalDashboardWidgets: CopilotWidget[],
) => {
  const preExpandedPrimary = [
    ...selectedWidgets,
    ...temporaryWidgets,
    ...mentionWidgets,
  ];
  const preExpandedSecondary = finalDashboardWidgets;

  const expandedPrimary = expandTabsToWidgets(preExpandedPrimary);
  const expandedSecondary = expandTabsToWidgets(preExpandedSecondary);
  const expandedAllWidgets = expandTabsToWidgets(allWidgets);

  const [dedupedPrimaryRaw, dedupedSecondaryRaw] = mutuallyExclude(
    [expandedPrimary, expandedSecondary],
    widgetDedupeKey,
  );

  const uniqueBy = (arr: CopilotWidget[], key: (item: CopilotWidget) => unknown) => {
    const seen = new Set();
    return arr.filter((item) => {
      const val = key(item);
      if (seen.has(val)) return false;
      seen.add(val);
      return true;
    });
  };

  const dedupedPrimary = uniqueBy(dedupedPrimaryRaw, widgetDedupeKey);
  const dedupedSecondary = uniqueBy(dedupedSecondaryRaw, widgetDedupeKey);

  return {
    expandedPrimaryWidgets: dedupedPrimary,
    expandedSecondaryWidgets: dedupedSecondary,
    expandedAllWidgets,
  };
};

const widgetDedupeKey = (widget: CopilotWidget) => widget.uuid ?? widget.widget_id;

function mutuallyExclude(
  groups: CopilotWidget[][],
  equalityKey: (item: CopilotWidget) => unknown,
) {
  return groups.reduce((acc, currentGroup, _) => {
    const newGroup = currentGroup.filter(
      (widget) =>
        !acc.some((group) =>
          group.some((item) => equalityKey(item) === equalityKey(widget)),
        ),
    );
    acc.push(newGroup);
    return acc;
  }, [] as CopilotWidget[][]);
}

function linkRows(widgets: CopilotWidgets, tools: AgentToolConfig[]): CopilotWidgets {
  if (!tools.length) return widgets;
  const { servers } = useMcpToolsStore.getState();
  const { getAppWidget } = useGetWidgetsStore.getState();
  const link = (rows: CopilotWidget[]) =>
    withMcpLinks(rows, tools, servers, (row) =>
      row.origin && row.widget_id
        ? getAppWidget(row.widget_id as WidgetId, row.origin)
        : undefined,
    );
  return {
    primary: link(widgets.primary),
    secondary: link(widgets.secondary),
    extra: link(widgets.extra),
  };
}

function expandTabsToWidgets(widgets: CopilotWidget[]): CopilotWidget[] {
  const tabWidgets = widgets.filter((widget) => widget.widget_id?.startsWith("tab_"));
  const nonTabWidgets = widgets.filter(
    (widget) => !widget.widget_id?.startsWith("tab_"),
  );

  const expandedWidgets: CopilotWidget[] = [];

  tabWidgets.forEach((tabWidget) => {
    const tabWidgetsInTab = tabWidget.metadata?.tabWidgets || [];
    if (tabWidgetsInTab.length > 0) {
      expandedWidgets.push(...tabWidgetsInTab);
    }
  });

  return [...nonTabWidgets, ...expandedWidgets];
}

export function extractUrls(text: string, limit = 4) {
  const urls = extractUrlsFromText(text);
  return urls.slice(0, limit);
}

export function convertArtifactsToContextItems(
  artifacts: ArtifactT[],
): CopilotContextItem[] {
  return artifacts
    .filter((artifact) => artifact.type !== "app")
    .map((artifact) => {
      return {
        uuid: artifact.uuid,
        name: artifact.name ?? "",
        description: artifact.description ?? "",
        metadata: artifact.metadata,
        data: {
          items: [
            {
              content: JSON.stringify(artifact.content),
              data_format: {
                data_type: "object",
                parse_as: artifact.type,
              },
            },
          ],
        },
      };
    });
}

export type XHeadersT = {
  traceId?: string | undefined;
  completionId?: string | undefined;
};

type GetQueryFetchParamsProps = {
  incomingMessage: string;
  abortSignal: AbortSignal;
  targetAgent?: Copilot;
};

type GetFunctionCallFetchParamsProps = {
  xHeaders: XHeadersT;
  abortSignal: AbortSignal;
  targetAgent?: Copilot;
};

type GetUpdateCopilotTitleFetchParamsProps = {
  xTraceId: string;
};

export type WorkspaceStateT = {
  agents:
    | {
        holder_url: string;
        id: string;
        name: string;
        description: string;
        features: Record<string, boolean>;
      }[]
    | undefined;
  action_history: string[];
  current_dashboard_uuid: string | undefined;
  current_dashboard_info: DashboardInfoT;
  current_page_context: string;
};

type HumanQueryPayload = {
  model?: string;
  widgets: CopilotWidgets | undefined;
  messages: Message[];
  context: CopilotContextItem[];
  urls: string[];
  workspace_state?: WorkspaceStateT;
  workspace_options?: Record<string, boolean | string>;
  timezone: string;
  tools?: AgentToolConfig[];
  skills_catalog?: SkillCatalogEntry[];
  selected_skills?: SkillPayload[];
};

type FunctionCallPayload = {
  model?: string;
  widgets: CopilotWidgets;
  messages: Message[];
  context: CopilotContextItem[];
  workspace_state?: WorkspaceStateT;
  workspace_options?: Record<string, boolean | string>;
  tools: AgentToolConfig[];
  skills_catalog?: SkillCatalogEntry[];
  selected_skills?: SkillPayload[];
};

type UpdateTitlePayload = {
  messages: Message[];
  workspace_state?: WorkspaceStateT;
  workspace_options?: Record<string, boolean | string>;
};
