import { get } from "lodash";
import { useCallback } from "react";
import { useParams } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";
import { getPreSignedUrl } from "~/api/auth.api";
import * as workspaceApi from "~/api/workspace.api";
import type { ParamDefT, StoredParamValue, WidgetT } from "~/components/types";
import type { WidgetId } from "~/components/Widgets";
import { getAiApiUrl } from "~/lib/constants";
import { getIframeWidget } from "~/lib/iframeWidgetRegistry";
import { getConfig } from "~/lib/runtimeConfig";
import { fetchAgent } from "~/lib/state/agentToken";
import { DASHBOARD_LOCKED_MESSAGE, useAppStore } from "~/lib/state/app";
import { useShallowAuthStore } from "~/lib/state/auth";
import { getSourceCredentials } from "~/lib/state/backendConnector";
import {
  type ArtifactT,
  type Citation,
  type Copilot,
  type CopilotCommandResultT,
  CopilotDataSchema,
  type CopilotDataT,
  CopilotError,
  CopilotErrorType,
  type CopilotFunctionCallError,
  type DataUrl,
  useCopilotStore,
  useShallowCopilotStore,
} from "~/lib/state/copilot";
import {
  type DashboardWidgetData,
  useShallowCopilotDataStore,
} from "~/lib/state/copilotData";
import { useSharedAppStore } from "~/lib/state/sharedApp";
import { useShallowThemeStore } from "~/lib/state/theme";
import {
  type AddGenerativeWidgetInputArgumentsT,
  type DataSourceT,
  extractUUIDFromURL,
  type ParamOptionQueryResultT,
  type ParamOptionQueryT,
  paramOptionQueryResult,
  type TaskRequest,
} from "~/lib/utils";
import { rowsOf } from "~/lib/utils/rawRows";
import { toError } from "~/lib/utils/utils";
import { isTruthy, isTruthyRecord } from "~/lib/utils/values";
import { createWidgetEndpoint } from "~/lib/utils/widgetParams";
import {
  buildOptionsRequest,
  buildWidgetRequest,
  type RequestProblem,
  requestInit,
} from "~/lib/utils/widgetRequest";
import { buildHtmlWidget, buildNoteWidget } from "./buildWidget";
import { useShallowAppWidgetsStore } from "./useGetAppWidgets";
import { findTabMatch } from "./useManageNavigationBar";
import { normalizeCitations } from "./utils";

const aiCopilotAiEnhancementsFF =
  getConfig().copilot.enabled && getConfig().copilot.aiEnhancements;

type DashboardCommandOptions = {
  dashboardId?: string | null;
};

function describeDataSource(dataSource: DataSourceT): string {
  return `widget '${dataSource.id}' from origin '${dataSource.origin}'`;
}

function describeEndpoint(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname || parsed.host || url;
  } catch {
    return url;
  }
}

function getGenerativeWidgetCitations(
  config: AddGenerativeWidgetInputArgumentsT,
): Citation[] {
  return normalizeCitations(config.citations);
}

function getGenerativeWidgetArtifacts(
  config: AddGenerativeWidgetInputArgumentsT,
): ArtifactT[] {
  return (Array.isArray(config.artifacts) ? config.artifacts : [])
    .map(normalizeGenerativeWidgetArtifact)
    .filter((artifact): artifact is ArtifactT => !!artifact);
}

const GENERATIVE_ARTIFACT_TYPES = ["text", "html"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function normalizeGenerativeWidgetArtifact(artifact: unknown): ArtifactT | null {
  if (!isRecord(artifact)) return null;

  if ("type" in artifact && "content" in artifact) {
    const name =
      asNonEmptyString(artifact.name) || asNonEmptyString(artifact.uuid) || uuidv4();
    return {
      ...artifact,
      uuid: asNonEmptyString(artifact.uuid) || name,
      name,
    } as ArtifactT;
  }

  if (!("source_info" in artifact) || !("data_format" in artifact)) return null;

  const sourceInfo = isRecord(artifact.source_info) ? artifact.source_info : {};
  const dataFormat = isRecord(artifact.data_format) ? artifact.data_format : {};
  const name =
    asNonEmptyString(sourceInfo.name) || asNonEmptyString(sourceInfo.uuid) || uuidv4();
  const type = GENERATIVE_ARTIFACT_TYPES.find((t) => t === dataFormat.parse_as);
  if (!type) return null;

  const parsedContent =
    typeof artifact.content === "string"
      ? artifact.content
      : JSON.stringify(artifact.content);
  const normalizedArtifact: Record<string, unknown> = {
    uuid: asNonEmptyString(sourceInfo.uuid) || name,
    name,
    description: sourceInfo.description,
    type,
    content: parsedContent,
  };
  if (sourceInfo.metadata !== undefined) {
    normalizedArtifact.metadata = sourceInfo.metadata;
  }

  return normalizedArtifact as ArtifactT;
}

export const GATEWAY_ERROR_BODY_CHARS = 300;

async function readErrorBody(response: Response): Promise<string | null> {
  try {
    const body = await response.clone().text();
    if (!body) return null;
    const normalized = body.replace(/\s+/g, " ").trim();
    return normalized ? normalized.slice(0, GATEWAY_ERROR_BODY_CHARS) : null;
  } catch {
    return null;
  }
}

async function parseResponseBody(
  response: Response,
  widgetType?: WidgetT["type"],
): Promise<unknown> {
  const contentType = response.headers.get("content-type") || "";
  const isHtml =
    widgetType === "html" ||
    contentType.includes("text/html") ||
    contentType.includes("application/xhtml+xml");

  const getResult = async () => {
    if (isHtml) return await response.text();

    const clonedRes = response.clone();
    try {
      return await response.json();
    } catch {
      return await clonedRes.text();
    }
  };

  const result = await getResult();
  if (typeof result !== "string") return result;

  return {
    content: result,
    data_format: {
      data_type: "object",
      parse_as: isHtml ? "html" : "text",
    },
  };
}

async function responseToCopilotError(
  response: Response,
  {
    context,
    badRequestHint,
  }: {
    context: string;
    badRequestHint: string;
  },
): Promise<CopilotError> {
  const endpoint = describeEndpoint(response.url);
  const body = await readErrorBody(response);
  const bodySuffix = body ? ` Response body: ${body}` : "";

  switch (response.status) {
    case 400:
      return new CopilotError(
        CopilotErrorType.GATEWAY_ERROR,
        `${context} hit '${endpoint}' and returned HTTP 400. ${badRequestHint}${bodySuffix}`,
      );
    case 404:
      return new CopilotError(
        CopilotErrorType.GATEWAY_ERROR,
        `${context} hit '${endpoint}' and returned HTTP 404. Re-check the resource identifier or query arguments, and confirm this data source is available in Workspace.${bodySuffix}`,
      );
    case 422:
      return new CopilotError(
        CopilotErrorType.GATEWAY_ERROR,
        `${context} hit '${endpoint}' and returned HTTP 422. The request shape was rejected by the data source.${bodySuffix}`,
      );
    default:
      return new CopilotError(
        CopilotErrorType.GATEWAY_ERROR,
        `${context} hit '${endpoint}' and returned HTTP ${response.status}.${bodySuffix}`,
      );
  }
}

export function useFunctionCall() {
  const { id: currentDashboardId = "" } = useParams();
  const getDashboardWidgetData = useShallowCopilotDataStore(
    (state) => state.getDashboardWidgetData,
  );

  const getAppWidget = useShallowAppWidgetsStore((s) => s.getAppWidget);
  const signedIn = useShallowAuthStore((s) => s.user !== null);
  const aiEnhancementsEnabled = useShallowThemeStore(
    (state) => state.aiEnhancements && aiCopilotAiEnhancementsFF,
  );

  const getWidgetFromBackend = useCallback(
    (backendName: string, widgetId: string): WidgetT | null => {
      const widget = getAppWidget(widgetId as WidgetId, backendName);
      return widget ?? null;
    },
    [getAppWidget],
  );

  const { externalCopilotHolders, selectedCopilot } = useShallowCopilotStore((s) => ({
    externalCopilotHolders: s.externalCopilotHolders,
    selectedCopilot: s.selectedCopilot,
  }));

  const { checkWidgetSignature } = useShallowCopilotDataStore((s) => ({
    checkWidgetSignature: s.checkWidgetSignature,
  }));

  const toFunctionCallError = useCallback(
    (
      error: unknown,
      fallbackMessage = "Error executing the function call.",
    ): CopilotFunctionCallError =>
      error instanceof CopilotError
        ? {
            error_type: error.error_type as CopilotErrorType,
            content: error.content,
          }
        : error instanceof Error
          ? {
              error_type: CopilotErrorType.UNEXPECTED,
              content: error.message || fallbackMessage,
            }
          : {
              error_type: CopilotErrorType.UNEXPECTED,
              content: fallbackMessage,
            },
    [],
  );

  const getWidgetData = useCallback(
    async (
      dataSources: DataSourceT[],
    ): Promise<(CopilotDataT | CopilotFunctionCallError)[]> => {
      const finalResults: (CopilotDataT | CopilotFunctionCallError)[] = [];
      for (const dataSource of dataSources) {
        if (dataSource.origin !== "the backend") {
          const { origin, id, input_args } = dataSource;
          const widgetUuid = dataSource.widget_uuid;
          if (
            widgetUuid &&
            checkWidgetSignature(widgetUuid, {
              origin: origin,
              widgetId: id,
              args: input_args,
            })
          ) {
            try {
              const widgetData = workspaceApi.readWidget(
                currentDashboardId,
                widgetUuid,
              );
              const cachedData = widgetData?.data;
              if (widgetData && isTruthy(cachedData)) {
                finalResults.push(convertToCopilotData(cachedData));
                continue;
              }
            } catch (error) {
              if (import.meta.env.DEV) {
                console.error("Error reading widget data", error);
              }
            }
          }
        }

        try {
          if (dataSource.id?.startsWith("tab_")) {
            console.warn(
              `Attempted to fetch data from tab widget ${dataSource.id}. Tab widgets should be expanded before reaching this stage.`,
            );
            throw new CopilotError(
              CopilotErrorType.NOT_FOUND,
              "Tab widgets cannot be used directly for data fetching. They should be expanded into their constituent widgets.",
            );
          }

          let result: unknown = null;
          switch (dataSource.origin) {
            case "the backend":
              result = await getPreSignedUrls(dataSource, getWidgetFromBackend);
              break;
            case "Workspace":
              result = await getWorkspaceWidgetsData(
                dataSource,
                getDashboardWidgetData,
                getWidgetFromBackend,
              );
              break;
            default:
              result = await getCustomWidgetsData(
                dataSource,
                getWidgetFromBackend,
                getDashboardWidgetData,
              );
              break;
          }
          finalResults.push(convertToCopilotData(result));
        } catch (error) {
          console.error("Error fetching data", error);
          finalResults.push(
            toFunctionCallError(
              error,
              `Fetching data for ${describeDataSource(dataSource)} failed.`,
            ),
          );
        }
      }
      return finalResults;
    },
    [
      getWidgetFromBackend,
      getDashboardWidgetData,
      checkWidgetSignature,
      toFunctionCallError,
    ],
  );

  const getParamOptions = useCallback(
    async (
      paramOptionsQueries: ParamOptionQueryT[],
    ): Promise<(CopilotDataT | CopilotFunctionCallError)[]> => {
      const finalResults: (CopilotDataT | CopilotFunctionCallError)[] = [];
      for (const paramOptionsQuery of paramOptionsQueries) {
        try {
          const result = await getWidgetsParamOptions(
            paramOptionsQuery,
            getWidgetFromBackend,
          );
          finalResults.push(convertToCopilotData(result));
        } catch (error) {
          console.error("Error fetching param options", error);
          finalResults.push(
            toFunctionCallError(
              error,
              `Fetching parameter options for widget '${paramOptionsQuery.id}' from origin '${paramOptionsQuery.origin}' failed.`,
            ),
          );
        }
      }
      return finalResults;
    },
    [getWidgetFromBackend, toFunctionCallError],
  );

  const fetchWidgetInfo = useCallback(
    async (widgetData: string): Promise<{ title?: string; description?: string }> => {
      if (!(aiEnhancementsEnabled && signedIn)) {
        return {};
      }

      try {
        const response = await fetchAgent(`${getAiApiUrl()}/v1/generate/widget_info`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            widget_generation_request: {
              widget_data: widgetData,
            },
          }),
        });

        if (!response.ok) {
          console.warn("Failed to fetch AI widget info:", response.status);
          return {};
        }

        return await response.json();
      } catch (error) {
        console.warn("Failed to fetch AI widget info:", error);
        return {};
      }
    },
    [aiEnhancementsEnabled, signedIn],
  );

  const resolveInnerTabId = useCallback(
    (rawInnerTab: string, dashboardId = currentDashboardId): string | undefined => {
      const appState = useAppStore.getState();
      const tab = appState.items?.[dashboardId];
      const navBar = tab?.data?.widgets?.find((w) => w.widgetId === "navigation_bar");
      const tabs: { id: string; name: string }[] = navBar?.storage?.tabs || [];
      if (tabs.length === 0) return undefined;

      return findTabMatch(tabs, rawInnerTab)?.id;
    },
    [currentDashboardId],
  );

  const addWidgetToDashboard = useCallback(
    async (dataSources: DataSourceT[]): Promise<CopilotCommandResultT[]> => {
      const finalResults: CopilotCommandResultT[] = [];
      for (const dataSource of dataSources) {
        try {
          const config: {
            dataArgs?: Record<string, unknown>;
            uiArgs?: Record<string, unknown>;
          } = {
            dataArgs: dataSource.input_args,
          };

          const rawInnerTab = dataSource.input_args?.inner_tab;
          if (typeof rawInnerTab === "string" && rawInnerTab) {
            const tabId = resolveInnerTabId(rawInnerTab);
            if (tabId) {
              config.uiArgs = { ...config.uiArgs, innerTab: tabId };
            }
          }

          const queryContent = dataSource.input_args?.query;
          if (queryContent && aiEnhancementsEnabled) {
            const aiInfo = await fetchWidgetInfo(JSON.stringify(queryContent));
            if (aiInfo.title || aiInfo.description) {
              config.uiArgs = config.uiArgs || {};
              if (aiInfo.title) {
                config.uiArgs.name = aiInfo.title;
              }
              if (aiInfo.description) {
                config.uiArgs.description = aiInfo.description;
              }
            }
          }

          await workspaceApi.createWidget(
            currentDashboardId,
            dataSource.origin,
            dataSource.id,
            config,
          );
          finalResults.push({
            status: "success",
            message: `Widget with id '${dataSource.id}' created successfully with arguments ${JSON.stringify(dataSource.input_args)}`,
          });
        } catch (error) {
          console.error("Error creating widget", error);
          finalResults.push({
            status: "error",
            message: `Error creating widget with id '${dataSource.id}': ${toError(error).message}`,
          });
        }
      }
      return finalResults;
    },
    [currentDashboardId, aiEnhancementsEnabled, fetchWidgetInfo, resolveInnerTabId],
  );

  const updateWidgetInDashboard = useCallback(
    async (dataSources: DataSourceT[]): Promise<CopilotCommandResultT[]> => {
      const finalResults: CopilotCommandResultT[] = [];
      for (const dataSource of dataSources) {
        const widgetUuid = dataSource.widget_uuid;
        try {
          if (widgetUuid) {
            const config: {
              dataArgs?: Record<string, unknown>;
              uiArgs?: Record<string, unknown>;
            } = {
              dataArgs: dataSource.input_args,
            };

            const widget = useAppStore.getState().getWidgetById(widgetUuid);
            const isNote = widget?.widgetId === "markdown" && !widget.endpoint?.url;

            if (isNote) {
              config.uiArgs = {};
              if (dataSource.input_args?.content) {
                config.uiArgs.text = dataSource.input_args.content;
              }
              if (dataSource.input_args?.name) {
                config.uiArgs.name = dataSource.input_args.name;
              }
              if (dataSource.input_args?.description) {
                config.uiArgs.description = dataSource.input_args.description;
              }
            }

            await workspaceApi.updateWidget(currentDashboardId, widgetUuid, config);
          }
          finalResults.push({
            status: "success",
            message: `Widget with uuid '${widgetUuid}' updated successfully with arguments ${JSON.stringify(dataSource.input_args)}`,
          });
        } catch (error) {
          console.error("Error updating widget", error);
          finalResults.push({
            status: "error",
            message: `Error updating widget with uuid '${widgetUuid}': ${toError(error).message}`,
          });
        }
      }
      return finalResults;
    },
    [currentDashboardId],
  );

  const assignTasksToAgents = useCallback(
    async (
      tasks: TaskRequest[],
      forwardMessageToAi: (
        message: string,
        fromAgentId: string,
        targetAgent: Copilot,
      ) => Promise<void>,
    ): Promise<CopilotCommandResultT[]> => {
      const finalResults: CopilotCommandResultT[] = [];
      const sourceAgentId = selectedCopilot?.id;

      if (!sourceAgentId) {
        return tasks.map((task) => ({
          status: "error",
          message: `Cannot assign task '${task.id}' without an active source agent.`,
        }));
      }

      for (const task of tasks) {
        try {
          const holder = externalCopilotHolders.find(
            (holder) =>
              holder.enabled !== false && holder.url === task.assigned_holder_url,
          );
          const agent = holder?.copilots?.find(
            (copilot) => copilot.id === task.assigned_agent_id,
          );

          if (!agent) {
            finalResults.push({
              status: "error",
              message: `Agent with id '${task.assigned_agent_id}' not found`,
            });
            continue;
          }

          await new Promise((resolve) => setTimeout(resolve, 100));
          await forwardMessageToAi(task.description, sourceAgentId, agent);

          finalResults.push({
            status: "success",
            message: `Task '${task.id}' finished by agent '${agent.name}' from holder '${task.assigned_holder_url}' and with id '${task.assigned_agent_id}'`,
          });
        } catch (error) {
          console.error("Error finding agent", error);
          finalResults.push({
            status: "error",
            message: `Error processing task with id '${task.id}': ${toError(error).message}`,
          });
        }
      }
      return finalResults;
    },
    [externalCopilotHolders, selectedCopilot],
  );

  const addGenerativeWidget = useCallback(
    async (
      config: AddGenerativeWidgetInputArgumentsT,
      options: DashboardCommandOptions = {},
    ): Promise<CopilotCommandResultT[]> => {
      const { widget_type, data, name, inner_tab } = config;
      const description = config.description ?? undefined;
      const dashboardId = options.dashboardId || currentDashboardId;
      const dashboard = useAppStore.getState().items?.[dashboardId];

      if (!dashboardId || !dashboard) {
        return [
          {
            status: "error",
            message:
              "No active dashboard was found. Open a dashboard route or provide a valid dashboard_id.",
          },
        ];
      }

      if (dashboard.data?.locked) {
        return [
          {
            status: "error",
            message: `Dashboard '${dashboardId}' is locked. ${DASHBOARD_LOCKED_MESSAGE}`,
          },
        ];
      }

      if (import.meta.env.DEV) {
        console.log("[GenerativeWidget] Creating widget:", {
          type: widget_type,
          dataType: typeof data,
        });
      }

      try {
        const widgetUuid = uuidv4();
        let newWidget: WidgetT;
        let artifact: ArtifactT | null = null;

        if (widget_type === "note") {
          const noteContent = data;
          const citations = getGenerativeWidgetCitations(config);
          const artifacts = getGenerativeWidgetArtifacts(config);
          newWidget = buildNoteWidget(noteContent, {
            uuid: widgetUuid,
            name,
            description,
            citations,
            artifacts,
          });

          artifact = {
            uuid: widgetUuid,
            name,
            description,
            type: "text",
            content: noteContent,
            metadata: { source: "generative_widget" },
          };
        } else if (widget_type === "html") {
          const htmlContent = data;
          newWidget = buildHtmlWidget(htmlContent, {
            uuid: widgetUuid,
            name,
            description,
          });

          artifact = {
            uuid: widgetUuid,
            name,
            description,
            type: "html",
            content: htmlContent,
            metadata: { source: "generative_widget" },
          };
        } else {
          throw new Error(
            `Unsupported widget type '${widget_type}'. Supported types are note and html.`,
          );
        }

        try {
          const response = await fetchAgent(
            `${getAiApiUrl()}/v1/generate/widget_info`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                widget_generation_request: {
                  name,
                  description,
                  widget_data: data,
                },
              }),
            },
          );
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const aiInfo = await response.json();
          if (aiInfo?.title) {
            newWidget = { ...newWidget, name: aiInfo.title };
          }
          if (aiInfo?.description) {
            newWidget = { ...newWidget, description: aiInfo.description };
          }
        } catch (e) {
          console.warn("[GenerativeWidget] Failed to fetch AI widget info:", e);
        }

        const requestedInnerTab =
          inner_tab ||
          (dashboardId === currentDashboardId
            ? new URLSearchParams(window.location.search).get("tab") || ""
            : "");
        if (requestedInnerTab) {
          const tabId = resolveInnerTabId(requestedInnerTab, dashboardId);
          if (tabId) {
            newWidget = { ...newWidget, innerTab: tabId };
          }
        }

        const createdWidgetUuid = await useAppStore
          .getState()
          .addWidget(dashboardId, newWidget);
        if (!createdWidgetUuid) {
          throw new Error(
            "Failed to add the generative widget to the target dashboard.",
          );
        }

        if (artifact) {
          useCopilotStore.getState().addArtifactToCurrentChat(artifact);
        }

        return [
          {
            status: "success",
            message: `Widget '${newWidget.name}' created successfully`,
            widget_uuid: createdWidgetUuid,
          },
        ];
      } catch (error) {
        console.error("[GenerativeWidget] Error creating widget:", error);
        return [
          {
            status: "error",
            message:
              error instanceof Error ? error.message : "Unknown error creating widget",
          },
        ];
      }
    },
    [currentDashboardId, resolveInnerTabId],
  );

  return {
    getWidgetData,
    getParamOptions,
    addWidgetToDashboard,
    updateWidgetInDashboard,
    assignTasksToAgents,
    addGenerativeWidget,
  };
}

function notSent(problems: RequestProblem[]): CopilotError {
  return new CopilotError(
    CopilotErrorType.NOT_FOUND,
    `The request was not sent: ${problems.map((p) => p.message).join("; ")}.`,
  );
}

function getRequest(widget: WidgetT, inputArgs: Record<string, unknown>): Request {
  const declared = (widget.params ?? [])
    .filter((param) => param.type !== "form")
    .map((param) => param.paramName);
  const undeclared = Object.keys(inputArgs).filter((name) => !declared.includes(name));
  if (undeclared.length)
    throw new CopilotError(
      CopilotErrorType.NOT_FOUND,
      `input_args names no param of this widget: ${undeclared.join(", ")}. Its params are: ${declared.join(", ") || "none"}.`,
    );
  const endpoint = createWidgetEndpoint(widget.endpoint ?? "");
  const built = buildWidgetRequest(
    {
      endpoint,
      params: widget.params,
      storage: { params: inputArgs as Record<string, StoredParamValue> },
    },
    getSourceCredentials(widget.sourceId, endpoint.url),
    widget.raw ? { raw: "true" } : {},
  );
  if (!built) throw new Error("Missing widget endpoint url.");
  if (!built.ok) throw notSent(built.problems);
  return new Request(
    built.request.url,
    requestInit(built.request, { credentials: "omit" }),
  );
}

type GetDashboardWidgetData = (widgetId: string) => DashboardWidgetData | undefined;

async function getCustomWidgetsData(
  dataSource: DataSourceT,
  getWidgetFromBackend: (backendName: string, widgetId: string) => WidgetT | null,
  getDashboardWidgetData: GetDashboardWidgetData,
): Promise<unknown> {
  let result: unknown = null;
  const context = `Fetching data for ${describeDataSource(dataSource)}`;
  const widgetUuid = dataSource.widget_uuid;

  const getCustomWidget = () => {
    const customWidget = getWidgetFromBackend(dataSource.origin, dataSource.id);
    if (customWidget) return customWidget;
    return widgetUuid ? useSharedAppStore.getState().getWidgetById(widgetUuid) : null;
  };

  const customWidget = getCustomWidget();
  if (!customWidget) {
    if (widgetUuid) {
      const widgetData = getDashboardWidgetData(widgetUuid);
      if (widgetData) return widgetData.data;
    }
    throw new CopilotError(
      CopilotErrorType.NOT_FOUND,
      `Widget with id ${dataSource.id} not found`,
    );
  }

  try {
    const request = getRequest(customWidget, dataSource.input_args);
    const response = await fetch(request);
    if (!response.ok) throw response;
    const requestResult = await parseResponseBody(
      response,
      customWidget.raw ? undefined : customWidget.type,
    );
    const dataKey = customWidget?.data?.dataKey;
    if (customWidget.raw) result = rowsOf(requestResult, customWidget.data?.rawDataKey);
    else if (dataKey && typeof requestResult === "object")
      result = get(requestResult, dataKey, requestResult);
    else result = requestResult;
  } catch (error) {
    console.log(`Error fetching data from ${dataSource.origin}`, error);
    if (error instanceof Response) {
      throw await responseToCopilotError(error, {
        context,
        badRequestHint:
          "The request reached the data source, but the input_args were invalid for this endpoint. Re-check the widget id and send only supported arguments from the latest workspace snapshot.",
      });
    }
    throw error;
  }

  return result;
}

async function getPreSignedUrls(
  dataSource: DataSourceT,
  getWidgetFromBackend: (backendName: string, widgetId: string) => WidgetT | null,
): Promise<DataUrl> {
  const fileWidget = getWidgetFromBackend("the backend", dataSource.id);
  if (fileWidget?.endpoint?.url) {
    const uuid = extractUUIDFromURL(fileWidget.endpoint.url);
    if (!uuid) throw new Error("Failed to get uuid from url");
    return getFileReference(uuid);
  }

  const fileUuid =
    extractUuidFromWidgetId(dataSource.id) ??
    (dataSource.widget_uuid ? extractUuidFromWidgetId(dataSource.widget_uuid) : null);
  if (fileUuid) return getFileReference(fileUuid);

  throw new CopilotError(
    CopilotErrorType.NOT_FOUND,
    `Failed to get data for data source with id ${dataSource.id}`,
  );
}

async function getWorkspaceWidgetsData(
  dataSource: DataSourceT,
  getDashboardWidgetData: GetDashboardWidgetData,
  getWidgetFromBackend: (backendName: string, widgetId: string) => WidgetT | null,
): Promise<unknown> {
  const widgetUuid = dataSource.widget_uuid;

  const targetId = widgetUuid ?? dataSource.id;
  const iframeParts = targetId?.split("::iframe::");
  if (iframeParts && iframeParts.length === 2) {
    const [parentUuid, subWidgetId] = iframeParts;
    const bridge = getIframeWidget(parentUuid);
    if (!bridge) {
      throw new CopilotError(CopilotErrorType.NOT_FOUND, "Iframe bridge not available");
    }
    const msg = await bridge.requestWidgetData(subWidgetId);
    return msg.data;
  }

  if (widgetUuid) {
    const widgetData = getDashboardWidgetData(widgetUuid);
    if (widgetData) return widgetData.data;
    const widget = getWidgetFromBackend("Workspace", dataSource.id);
    if (widget?.storage) {
      const { rowsData, html } = widget.storage;
      if (rowsData || html) return rowsData || html;
    }
  }
  throw new CopilotError(
    CopilotErrorType.NOT_FOUND,
    `Widget with id ${dataSource.id} not found`,
  );
}

export function extractUuidFromWidgetId(widgetId: string): string | null {
  const uuidRegex =
    /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;
  const match = widgetId.match(uuidRegex);
  if (match) {
    const widgetUuid = match[0];
    return widgetUuid;
  }
  return null;
}

export function parseUrlExpiration(url: string, defaultTtlSeconds: number): number {
  if (!url) return defaultTtlSeconds * 1000;
  const expiresMatch = url.split("Expires=")?.[1];
  if (!expiresMatch) return defaultTtlSeconds * 1000;
  const parsed = Number.parseInt(expiresMatch, 10);
  if (Number.isNaN(parsed)) return defaultTtlSeconds * 1000;
  return parsed * 1000;
}

async function getFileReference(uuid: string): Promise<DataUrl> {
  const ttl = 3600;
  const response = await getPreSignedUrl(uuid, ttl);
  const reference = response.pre_signed_url;
  const expiration = parseUrlExpiration(reference, ttl);
  const extension = response.original_file_name.split(".").pop()?.toLowerCase();
  if (!(reference && extension)) throw new Error("Failed to get required data");
  return {
    url: reference,
    data_format: {
      data_type: extension,
      filename: response.original_file_name,
    },
    expiration: expiration,
  } as DataUrl;
}

export async function getWidgetsParamOptions(
  paramOptionsQuery: ParamOptionQueryT,
  getWidgetFromBackend: (backendName: string, widgetId: string) => WidgetT | null,
): Promise<ParamOptionQueryResultT> {
  const widget = getWidgetFromBackend(paramOptionsQuery.origin, paramOptionsQuery.id);
  if (!widget)
    throw new CopilotError(
      CopilotErrorType.NOT_FOUND,
      `Widget with id ${paramOptionsQuery.id} not found`,
    );
  const paramName = paramOptionsQuery.param;
  const widgetParam = (widget.params ?? []).find(
    (p): p is ParamDefT<"endpoint"> =>
      p.paramName === paramName && p.type === "endpoint",
  );
  if (!widgetParam) throw new Error(`Param ${paramName} not found`);
  const built = buildOptionsRequest(
    widgetParam,
    {
      params: widget.params ?? [],
      values: paramOptionsQuery.options_endpoint_input_args,
    },
    getSourceCredentials(widget.sourceId, widgetParam.optionsEndpoint),
  );
  if (!built) throw new Error(`Endpoint not found for param ${paramName}`);
  if (!built.ok) throw notSent(built.problems);
  const response: unknown = await fetch(
    new Request(built.request.url, requestInit(built.request, { credentials: "omit" })),
  ).then((res) => res.json());
  if (!Array.isArray(response)) throw new Error("Failed to parse param options result");
  const optionsData = response.map((option: unknown) => {
    if (typeof option === "string") return { label: option, value: option };
    return option;
  });
  const result = paramOptionQueryResult.safeParse({
    param_options: [{ param: paramName, options: optionsData }],
  });
  if (!result.success) {
    if (import.meta.env.DEV) console.error(result.error);
    throw new Error("Failed to parse param options result");
  }
  return result.data;
}

export function convertToCopilotData(data: unknown): CopilotDataT {
  let items: unknown;
  let extra_citations: unknown = [];

  const isSingleStringField = (obj: unknown): obj is Record<string, string> => {
    if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return false;
    const record = obj as Record<string, unknown>;
    const keys = Object.keys(record);
    return keys.length === 1 && typeof record[keys[0]] === "string";
  };

  const toDataContent = (obj: Record<string, string>) => {
    const key = Object.keys(obj)[0];
    return {
      content: obj[key],
      data_format: {
        data_type: "object" as const,
        parse_as: "text" as const,
      },
    };
  };

  const processArrayForSingleStringFields = (arr: unknown[]) => {
    if (arr.length > 0 && arr.every(isSingleStringField)) {
      return arr.map(toDataContent);
    }
    return arr;
  };

  let dataToProcess: unknown = data;
  if (isTruthyRecord(data) && Array.isArray(data.rowData)) {
    dataToProcess = data.rowData;
  }

  if (typeof dataToProcess === "string") {
    items = [
      {
        content: dataToProcess,
        data_format: {
          data_type: "object" as const,
          parse_as: "text" as const,
        },
      },
    ];
  } else if (Array.isArray(dataToProcess)) {
    items = processArrayForSingleStringFields(dataToProcess);
  } else {
    const record: Record<string, unknown> = isTruthyRecord(dataToProcess)
      ? dataToProcess
      : {};
    const { extra_citations: citations, ...rest } = record;
    extra_citations = citations || [];

    if (isSingleStringField(rest)) {
      items = [toDataContent(rest)];
    } else {
      items = [rest];
    }
  }

  const result = CopilotDataSchema.safeParse({ items, extra_citations });
  if (result.success) return result.data;

  return { items: [{ content: JSON.stringify(data) }] };
}
