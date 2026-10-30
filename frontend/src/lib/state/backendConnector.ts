import cloneDeep from "lodash/cloneDeep";
import isEqual from "lodash.isequal";
import { toast } from "sonner";
import { persist, subscribeWithSelector } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import { createWithEqualityFn } from "zustand/traditional";
import { shallow } from "zustand/vanilla/shallow";
import { deleteApiSource } from "~/api/auth.api";
import type { BackendPermissionsT, PermissionsT } from "~/api/user_roles.api";
import ValidateApiSourceWorker from "~/apiSource.worker?worker";
import {
  type CATEGORY_OPTIONS,
  updateWidgetEndpoints,
} from "~/components/DataConnectors/common/helpers";
import type { GroupTypes, WidgetT } from "~/components/types";
import type { WidgetId } from "~/components/Widgets";
import type { ProcessedBackendT } from "~/hooks/useProcessBackendWidgets";
import type { ProcessedTemplate, SharedPromptT } from "~/hooks/useSharedTemplates";
import { getConfig } from "~/lib/runtimeConfig";
import type { Selector } from "~/lib/state/app";
import { useMcpToolsStore } from "~/lib/state/mcpTools";
import {
  usePermissionsStore,
  useShallowPermissionsStore,
} from "~/lib/state/permissions";
import { setSourceUrlLookup } from "~/lib/utils/fetch";
import { createIndexedDBStorage } from "~/lib/utils/indexDB";
import type { InvalidItem } from "~/lib/utils/invalidItems";
import { type ShowNotificationProps, showNotification } from "~/lib/utils/toast";
import {
  getApiSourceWidgets,
  processWorkerResults,
  type WorkerResult,
  widgetsSchemaReady,
} from "~/lib/utils/validateBackend";
import type { ComposedWidgetsSchema } from "~/lib/utils/widgetsSchemaValidation";
import { getPluginVizTypes } from "~/plugins/registry";
import { mcpServerUsesTokenAuth } from "~/types/appMcpServer";
import type { MetaDataWidgetType } from "~/types/auth.type";
import {
  forgetInvalidItems,
  formatZodErrorMessage,
  showInvalidItemsToast,
  showUnrecognizedKeysToast,
} from "~/utils/zodErrors";
import type { UnrecognizedKeysReport, WidgetsType } from "~/utils/zodForms";
import type { Extension } from "../constants";
import type { TabLayout } from "../templates";
import { createParamDefs, dispatchSaveState, getJsonWidget } from "../utils";

let validateApiSourceWorker: Worker | null = null;

const SOURCE_FRESH_MS = 30 * 60 * 1000;

function validationKey(source: Source, schemaId: string, pluginVizTypes: string[]) {
  return JSON.stringify([
    source.url,
    source.updatedDate,
    (source.endpointHeaders ?? []).map(({ key, location }) => [
      key,
      location ?? "headers",
    ]),
    schemaId,
    [...pluginVizTypes].sort(),
  ]);
}

export function autoRegisterMcpForSource(source: Source) {
  const sourceId = source.id;
  if (!sourceId) return;
  const mcpEntries = (source.templates || []).flatMap((t) => t.mcpServers || []);
  if (mcpEntries.length === 0) return;

  const store = useMcpToolsStore.getState();
  const hasAuthorization = (source.endpointHeaders ?? []).some(
    (h) => h.location !== "query" && h.key.toLowerCase() === "authorization",
  );

  for (const entry of mcpEntries) {
    const alreadyRegistered = useMcpToolsStore
      .getState()
      .servers.some((s) => s.sourceId === sourceId && s.declaredName === entry.name);
    if (alreadyRegistered) continue;

    store.addServer({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: entry.name,
      declaredName: entry.name,
      url: entry.url,
      enabled: !mcpServerUsesTokenAuth(entry) || hasAuthorization,
      autoReconnect: true,
      tools: [],
      sourceId,
      authType: entry.authType,
    });
  }
}

// biome-ignore format: off
export const ConnectionTypes= ["file", "single", "advanced-backend", "database", "widgetMetadata", "plugin"] as const;

export type ConnectionType = (typeof ConnectionTypes)[number];

export type WidgetMetadataItem = {
  widgetId: string;
  widgetType: MetaDataWidgetType;
  name: string;
  description?: string | null;
  storage?: {
    autoUpdateMetadataOnRun?: boolean;
    params?: Record<string, string>;
    [key: string]: unknown;
  };
  category?: string | null;
  subCategory?: string | null;
  source?: string | null;
  widgetConfig?: Partial<WidgetT>;
};

export type WidgetMetadata = {
  description?: null | string;
  category?: null | (typeof CATEGORY_OPTIONS)[number];
  subCategory?: null | string;
};

export type StoredFile = WidgetMetadata & {
  uuid: string;
  id: string;
  url: string;
  extension: Extension;
  name: string;
  dataKey: null | string;
  originalFileName: null | string;
  source?: null | string;
  updatedDate?: string;
  createdDate?: string;
};

export interface BackendTemplate {
  templateId?: string;
  id?: `custom-${string}`;
  name: string;
  description: string;
  selected_agent?: string;
  img?: string;
  img_dark?: string;
  img_light?: string;
  authentication?: string;
  tabs: Record<
    string,
    { id: string; name: string; layout: TabLayout<{ groups: string[] }>[] }
  >;
  groups?: {
    name: string;
    paramName?: string;
    type: GroupTypes;
    widgetIds?: string[];
    defaultValue: string;
  }[];
  prompts?: string[];
  mcpServers?: {
    name: string;
    description?: string;
    url: string;
    authType?: "oauth" | "token";
  }[];
  allowCustomization?: boolean;
}

export type BackendAgent = {
  id: string;
  name: string;
};

export function withoutHeaderValues<
  T extends { endpointHeaders?: Source["endpointHeaders"] },
>(source: T): T {
  if (!source.endpointHeaders) return source;
  return {
    ...source,
    endpointHeaders: source.endpointHeaders.map(({ key, location }) => ({
      key,
      value: "",
      ...(location ? { location } : {}),
    })),
  };
}

const hasAuthorizationHeader = (headers: Source["endpointHeaders"] | undefined) =>
  !!headers?.some(
    (h) => h.location !== "query" && h.key.toLowerCase() === "authorization",
  );

export type Source = {
  endpointHeaders:
    | { key: string; value: string; location?: "headers" | "query" }[]
    | null;
  uuid?: string;
  id: string;
  name: string;
  url: string;
  status?: "success" | "error" | "pending" | "rehydrated";
  validatedAt?: number;
  validatedWith?: string;
  widgets?: WidgetsType;
  templates?: BackendTemplate[];
  agents?: BackendAgent[];
  isSharedSource?: boolean;
  createdDate?: string;
  updatedDate?: string;
  isEntityBackend?: boolean | null;
  hasApiKey?: boolean | null;
  mcpServers?: string[] | null;
};

export type WidgetMetaDataT<T extends WidgetT["connectionType"]> = T extends "file"
  ? StoredFile
  : WidgetMetadataItem;

export function isMetadataType<T extends WidgetT["connectionType"]>(
  widget: WidgetT,
  metadata: unknown,
  connectionType: T | T[],
): metadata is WidgetMetaDataT<T> {
  if (Array.isArray(connectionType)) {
    return connectionType.some((type) => widget.connectionType === type);
  }
  return widget.connectionType === connectionType;
}

export function getTemplateWidgetsMetadata(
  template: BackendTemplate | ProcessedTemplate<SharedPromptT>,
  backend: Source | ProcessedBackendT<SharedPromptT> | undefined,
) {
  const builtInWidgetIds = new Set<WidgetId>();

  const widgetCounts = Object.values(template.tabs || {}).reduce(
    (acc, tab) => {
      for (const layout of Object.values(tab.layout || {})) {
        const widgetId = layout.i;
        const isBuiltIn = getJsonWidget(widgetId) !== null;
        const backendWidget = backend?.widgets?.[widgetId];
        if (backendWidget?.disabled || !(backendWidget || isBuiltIn)) continue;
        acc[widgetId] = (acc[widgetId] || 0) + 1;

        if (isBuiltIn) builtInWidgetIds.add(widgetId);
      }
      return acc;
    },
    {} as Record<string, number>,
  );

  const widgets = Object.values(backend?.widgets || {})
    .filter(
      (w) =>
        w.widgetId !== undefined && widgetCounts[w.widgetId] !== undefined && w.name,
    )
    .map((item) => ({
      id: item.widgetId as string,
      name: item.name,
      description: item.description ?? undefined,
      count: widgetCounts[item.widgetId as string],
    }));

  if (builtInWidgetIds.size > 0) {
    for (const widgetId of builtInWidgetIds) {
      const count = widgetCounts[widgetId];
      const w = getJsonWidget(widgetId);
      if (!w?.name) continue;
      const { name, description } = w;
      widgets.push({ id: widgetId, name, description, count });
    }
  }

  const totalWidgets = Object.values(widgetCounts).reduce((a, b) => a + b, 0);

  return { widgets, totalWidgets };
}

export type ValidateBackend = {
  widgets: WidgetsType;
  errorMessage: string | null;
  templateErrorMessage: string | null;
  templateWarningMessage?: string | null;
  unrecognizedKeysMessage?: UnrecognizedKeysReport[] | null;
  totalFailed: number;
  templates: BackendTemplate[];
  agents: BackendAgent[];
  unsupportedWidgets?: string[];
  unrenderedWidgets?: string[];
  validWidgets?: WidgetsType;
  validTemplates?: BackendTemplate[];
  invalidItems?: InvalidItem[];
  fatalErrorMessage?: string | null;
  uncheckedRoutes?: string[];
};

export interface BackendConnectorStore {
  widgetMetadata: WidgetMetadataItem[];
  setWidgetMetadata: (values: WidgetMetadataItem[]) => void;
  getWidgetMetadataById: (id: string | undefined) => WidgetMetadataItem | undefined;
  hasApiSources: () => boolean;
  apiSources: Source[];
  isLoadingBackends: boolean;
  sourcesLoaded: boolean;
  checkExistingBackend: (params: Record<"name" | "url" | "id", string>) => {
    name?: string;
    url?: string;
  } | null;
  addApiSource: (source: Source) => Source;
  getApiSourceById: (id: string) => Source | undefined;
  deleteApiSource: (
    source: Partial<Source> & { sourceId?: string },
    notify?: ShowNotificationProps,
  ) => Promise<boolean>;
  updateApiSources: (values: Source[], showToastOnError?: boolean) => Promise<boolean>;
  forgetValidation: () => void;
  updateApiSource: <PT extends boolean = false>(
    source: PT extends false
      ? Source
      : Partial<Pick<Source, "id" | "url" | "name" | "endpointHeaders">>,
    partial?: PT,
  ) => Promise<Omit<ValidateBackend, "totalFailed">>;
  refreshApiSourceById: (
    sourceId: string,
    activeDashboardId?: string,
  ) => Promise<{ success: boolean }>;
  removeApiSource: (id: string) => void;
  getStoredFileById: (id: string) => StoredFile | undefined;
  storedFiles: StoredFile[];
  setStoredFiles: (values: StoredFile[]) => void;
  updateBackendConnector: (
    value: Partial<
      Pick<BackendConnectorStore, "apiSources" | "storedFiles" | "widgetMetadata">
    >,
  ) => Promise<void>;
  getTemplatePrompts: (templateId: string) => string[];
  queuedRefreshIds?: string[];
  updateQueuedRefreshId: (id: string, refresh?: boolean) => void;
}

export const useBackendConnectorStore = createWithEqualityFn<BackendConnectorStore>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        queuedRefreshIds: [],
        updateQueuedRefreshId: (id, refresh = false) => {
          if (get().apiSources.length === 0) return;
          const queuedIds = new Set(get().queuedRefreshIds);

          if (refresh) {
            queuedIds.add(id);
          } else {
            queuedIds.delete(id);
          }
          set({ queuedRefreshIds: Array.from(queuedIds) });
        },
        checkExistingBackend: ({ name, url, id }) => {
          const cleanUrl = url.trim().replace(/\/+$/, "").trim();

          const apiSources = get().apiSources;
          const result = apiSources.reduce(
            (acc, backend) => {
              if (backend.id === id) return acc;
              if (backend.url === cleanUrl) {
                acc.url = `"${backend.name}" is already using this URL`;
              }
              if (backend.name === name) {
                acc.name = `A backend with the name "${name}" already exists`;
              }
              return acc;
            },
            {} as { name?: string; url?: string },
          );

          return Object.keys(result).length > 0 ? result : null;
        },

        getTemplatePrompts: (templateId) =>
          get().apiSources.flatMap(
            (source) =>
              source.templates?.find((t) => t.id === templateId)?.prompts ?? [],
          ),
        getWidgetMetadataById: (id) =>
          id ? get().widgetMetadata.find((item) => item.widgetId === id) : undefined,
        widgetMetadata: [],
        setWidgetMetadata: (widgetMetadata) => set({ widgetMetadata }),
        apiSources: [],
        isLoadingBackends: false,
        sourcesLoaded: false,
        storedFiles: [],
        forgetValidation: () =>
          set({
            apiSources: get().apiSources.map((source) => ({
              ...source,
              validatedAt: 0,
            })),
          }),
        getApiSourceById: (id) => get().apiSources.find((source) => source.id === id),
        deleteApiSource: async (source, notify) => {
          const sourceId = source.sourceId || source.id;

          try {
            if (sourceId) useMcpToolsStore.getState().removeSourceServer(sourceId);

            if (!sourceId) return false;
            await deleteApiSource(sourceId);
            get().removeApiSource(sourceId);
            if (notify) showNotification(notify);
          } catch (error) {
            console.error("Error deleting API source:", error);
            return false;
          }
          return true;
        },
        hasApiSources: () => get().apiSources.length > 0,
        getStoredFileById: (id) => get().storedFiles.find((item) => item.id === id),
        setStoredFiles: (storedFiles) => set({ storedFiles }),
        refreshApiSourceById: async (sourceId, activeDashboardId) => {
          const apiSources = cloneDeep(get().apiSources);

          const source = apiSources.find((s) => s.id === sourceId);
          if (!source) return { success: false };

          const { errorMessage, widgets, templateErrorMessage } =
            await get().updateApiSource(source);

          if (errorMessage || templateErrorMessage) {
            get().addApiSource({ ...source, status: "error" });
            toast.error("Backend connection failed", {
              id: `refresh-${source.id}`,
              description: `${source.name} moved to inactive connections.`,
            });
            return { success: false };
          }

          updateWidgetEndpoints({ ...source, widgets }, activeDashboardId);
          toast.success("Backend refreshed", {
            id: `refresh-${source.id}`,
            description: activeDashboardId
              ? `${source.name} widgets in current dashboard have been updated.`
              : `${source.name} refreshed successfully.`,
          });

          return { success: true };
        },
        updateApiSource: async (
          source:
            | Source
            | Partial<Pick<Source, "id" | "url" | "name" | "endpointHeaders">>,
          partial?: boolean,
        ) => {
          if (partial && !source.id) {
            throw new Error("Source ID is required for partial updates.");
          }
          const validated = await getApiSourceWidgets(source as Source);
          let { widgets, templates, agents } = validated;
          const { templateWarningMessage, unrecognizedKeysMessage, invalidItems } =
            validated;

          const loadsWithInvalidItems = !!validated.validWidgets;
          const errorMessage = loadsWithInvalidItems
            ? validated.fatalErrorMessage || null
            : validated.errorMessage;
          const templateErrorMessage = loadsWithInvalidItems
            ? null
            : validated.templateErrorMessage;
          if (loadsWithInvalidItems && !errorMessage) {
            widgets = validated.validWidgets ?? widgets;
            templates = validated.validTemplates ?? templates;
          }

          let updatedSource: Source | undefined;
          const existingSource =
            (source.id ? get().getApiSourceById(source.id) : undefined) ||
            ({} as Source);

          if (!(errorMessage || templateErrorMessage)) {
            const updatedWidgets = Object.entries(widgets).reduce<WidgetsType>(
              (acc, [key, widget]) => {
                widget.params = createParamDefs(widget, source.url);

                acc[key] = {
                  ...widget,
                  widgetId: key,
                };
                return acc;
              },
              {},
            );

            updatedSource = {
              ...existingSource,
              ...source,
              widgets: updatedWidgets,
              templates,
              agents,
              status: "success",
            };
          } else if (partial) {
            updatedSource = {
              ...existingSource,
              ...source,
              agents,
              status: "error",
            };
            widgets = existingSource?.widgets || {};
            templates = existingSource?.templates || [];
            agents = existingSource?.agents || [];
          }

          if (updatedSource) {
            const promise = new Promise<void>((resolve) => {
              const checkLoading = () => {
                const { isLoadingBackends } = get();
                if (!isLoadingBackends) {
                  get().addApiSource(updatedSource);
                  return resolve();
                }
                setTimeout(checkLoading, 100);
              };
              checkLoading();
            });
            await promise;
          }

          if (updatedSource && unrecognizedKeysMessage) {
            showUnrecognizedKeysToast(updatedSource, unrecognizedKeysMessage);
          }
          if (updatedSource && invalidItems && invalidItems.length > 0) {
            showInvalidItemsToast(updatedSource, invalidItems, { force: true });
          }

          return {
            widgets,
            errorMessage,
            templateErrorMessage,
            templateWarningMessage,
            unrecognizedKeysMessage,
            invalidItems,
            templates,
            agents,
          };
        },
        addApiSource: (incoming: Source) => {
          const source = withoutHeaderValues(incoming);
          const apiSources = cloneDeep(get().apiSources);
          const existingSource = apiSources.find((s) => s.id === source.id);
          const isNewSource = !existingSource;
          source.hasApiKey = hasAuthorizationHeader(source.endpointHeaders);

          if (existingSource) Object.assign(existingSource, source);
          else apiSources.push(source);

          set({ apiSources });

          if (isNewSource && source.status === "success") {
            autoRegisterMcpForSource(source);
          }

          return source;
        },
        updateApiSources: async (values, showToastOnWarning = false) => {
          const currentApiSources = get().apiSources.reduce(
            (acc, source) => {
              acc[source.id] = source;
              return acc;
            },
            {} as Record<string, Source>,
          );

          const apiSources = values.map((value) => {
            const source = withoutHeaderValues(value);
            const { endpointHeaders = [] } = source;
            const curr = currentApiSources[source.id];
            return {
              ...source,
              endpointHeaders,
              widgets: curr?.widgets || {},
              templates: curr?.templates || [],
              agents: curr?.agents || [],
              status: curr?.status || "pending",
              validatedAt: curr?.validatedAt,
              validatedWith: curr?.validatedWith,
              hasApiKey: hasAuthorizationHeader(endpointHeaders),
            } as Source;
          });

          set({
            apiSources,
            isLoadingBackends: apiSources.length > 0,
            sourcesLoaded: true,
          });

          if (apiSources.length === 0) return true;

          let widgetsSchema: ComposedWidgetsSchema;
          try {
            widgetsSchema = await widgetsSchemaReady();
          } catch (error) {
            set({
              isLoadingBackends: false,
              apiSources: apiSources.map((source) => ({ ...source, status: "error" })),
            });
            toast.error("Your backends could not be checked", {
              id: "widgets-schema-unavailable",
              description: error instanceof Error ? error.message : String(error),
            });
            return false;
          }
          const pluginVizTypes = [...getPluginVizTypes()];
          const now = Date.now();
          const keyOf = (source: Source) =>
            validationKey(source, widgetsSchema.$id, pluginVizTypes);
          const isFresh = (source: Source) =>
            (source.status === "success" || source.status === "rehydrated") &&
            source.validatedWith === keyOf(source) &&
            now - (source.validatedAt ?? 0) < SOURCE_FRESH_MS;
          const stamp = (source: Source): Source =>
            source.status === "success"
              ? { ...source, validatedAt: Date.now(), validatedWith: keyOf(source) }
              : source;
          const freshById = new Map(
            apiSources
              .filter(isFresh)
              .map((source) => [source.id, { ...source, status: "success" as const }]),
          );
          const stale = apiSources.filter((source) => !freshById.has(source.id));
          if (stale.length === 0) {
            set({
              isLoadingBackends: false,
              apiSources: apiSources.map(
                (source) => freshById.get(source.id) ?? source,
              ),
            });
            return true;
          }
          const needsSaveState = false;
          const saveState = () => needsSaveState && dispatchSaveState();

          const onMessage = (event: MessageEvent<WorkerResult>) => {
            const data = event.data;
            let finalSources = data.apiSources;

            const { toastErrors, unrecognizedKeysMessages, invalidItems } = data;

            const checked = new Map(finalSources.map((s) => [s.id, stamp(s)]));
            finalSources = data.__partial
              ? get().apiSources.map((s) => {
                  const updated = checked.get(s.id);
                  return updated ? { ...s, ...updated } : s;
                })
              : apiSources.map((s) => checked.get(s.id) ?? freshById.get(s.id) ?? s);

            if (showToastOnWarning) {
              for (const { source, message } of toastErrors) {
                toast.warning(`App Warning: ${source.name}`, {
                  id: `backend-app-warning-${source.id}`,
                  descriptionClassName: "max-h-80 overflow-y-auto",
                  description: formatZodErrorMessage(message),
                });
              }

              for (const { source, reports } of unrecognizedKeysMessages) {
                showUnrecognizedKeysToast(source, reports);
              }
            }

            const withInvalidItems = new Set(
              invalidItems.map(({ source }) => source.id),
            );
            if (!data.__partial) {
              forgetInvalidItems(
                finalSources
                  .filter(
                    (s) =>
                      checked.has(s.id) &&
                      s.status === "success" &&
                      !withInvalidItems.has(s.id),
                  )
                  .map((s) => s.id),
              );
            }
            for (const { source, items } of invalidItems) {
              showInvalidItemsToast(source, items, { force: showToastOnWarning });
            }

            if (!data.__partial) saveState();

            set({
              isLoadingBackends: data.__partial,
              apiSources: finalSources,
            });
          };

          const fallbackToMainThread = async () => {
            const results = await Promise.all(
              stale.map(async (source) => {
                const result = await getApiSourceWidgets(source, {
                  widgetsSchema,
                  pluginVizTypes,
                });
                return { source, result };
              }),
            );
            onMessage({ data: processWorkerResults(results) } as MessageEvent);
          };

          if (import.meta.env.VITEST) {
            await fallbackToMainThread();
            return true;
          }

          if (!validateApiSourceWorker) {
            validateApiSourceWorker = new ValidateApiSourceWorker();
          }

          validateApiSourceWorker.onmessage = onMessage;
          validateApiSourceWorker.onerror = async (error) => {
            console.error("Worker error:", error.message);
            await fallbackToMainThread();
          };

          validateApiSourceWorker.postMessage({
            config: getConfig(),
            apiSources: stale,
            pluginVizTypes,
            widgetsSchema,
          });

          return new Promise((resolve) => {
            const checkLoading = () => {
              if (!get().isLoadingBackends) return resolve(true);

              setTimeout(checkLoading, 100);
            };
            checkLoading();
          });
        },
        removeApiSource: (id) => {
          const apiSources = get().apiSources.filter((source) => source.id !== id);
          set({ apiSources });
        },
        updateBackendConnector: async (params) => {
          const { apiSources, storedFiles, widgetMetadata } = params;
          if (Array.isArray(apiSources)) get().updateApiSources(apiSources);
          set({ storedFiles, widgetMetadata });
        },
      }),
      {
        name: "backend-connector",
        storage: createIndexedDBStorage(),
        partialize: (state) =>
          ({
            apiSources: state.apiSources
              .filter((source) => source.status === "success")
              .map(({ endpointHeaders: _, widgets, ...source }) => ({
                ...source,
                widgets:
                  widgets &&
                  Object.fromEntries(
                    Object.entries(widgets).map(
                      ([id, { endpointHeaders: _headers, ...widget }]) => [id, widget],
                    ),
                  ),
                status: "rehydrated" as const,
              })),
          }) as unknown as BackendConnectorStore,
      },
    ),
  ),
  shallow,
);

function getRoleSharedBackend(
  permissions: PermissionsT,
  sourceId: string,
): BackendPermissionsT | undefined {
  return permissions.backends.find(
    (backend) => backend.uuid === sourceId && backend.access === "access",
  );
}

setSourceUrlLookup(
  (sourceId) =>
    useBackendConnectorStore.getState().getApiSourceById(sourceId)?.url ??
    getRoleSharedBackend(usePermissionsStore.getState().permissions, sourceId)?.url,
);

export type WidgetSourceState = "none" | "available" | "pending" | "unavailable";

export const SOURCE_UNAVAILABLE_MESSAGE =
  "This data connection is not available to you";

export const canFetchFromSource = (state: WidgetSourceState) =>
  state === "none" || state === "available";

type SourcedWidget = Pick<WidgetT, "sourceId" | "connectionType" | "isSharedWidget">;

function sourceStateOf(
  widget: SourcedWidget | null | undefined,
  connector: Pick<BackendConnectorStore, "getApiSourceById" | "sourcesLoaded">,
  permissions: PermissionsT,
): WidgetSourceState {
  const sourceId = widget?.connectionType === "file" ? null : widget?.sourceId;
  if (!sourceId) return "none";
  if (widget?.isSharedWidget) return "available";
  if (
    connector.getApiSourceById(sourceId) ||
    getRoleSharedBackend(permissions, sourceId)
  )
    return "available";
  return connector.sourcesLoaded ? "unavailable" : "pending";
}

export function getWidgetSourceState(widget: SourcedWidget | null | undefined) {
  return sourceStateOf(
    widget,
    useBackendConnectorStore.getState(),
    usePermissionsStore.getState().permissions,
  );
}

export function useWidgetSourceState(widget: SourcedWidget | null | undefined) {
  const { sourceId, connectionType, isSharedWidget } = widget ?? {};
  const permissions = useShallowPermissionsStore((state) => state.permissions);
  return useShallowBackendConnectorStore((state) =>
    sourceStateOf({ sourceId, connectionType, isSharedWidget }, state, permissions),
  );
}

export function useShallowBackendConnectorStore<T>(
  selector: Selector<BackendConnectorStore, T>,
): T {
  return useBackendConnectorStore(useShallow(selector), (prev, next) =>
    isEqual(prev, next),
  );
}
