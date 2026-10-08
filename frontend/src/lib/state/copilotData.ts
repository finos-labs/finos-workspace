import cloneDeep from "lodash/cloneDeep";
import debounce from "lodash.debounce";
import isEqual from "lodash.isequal";
import { persist, subscribeWithSelector } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import { createWithEqualityFn } from "zustand/traditional";
import { shallow } from "zustand/vanilla/shallow";
import type { WorkspaceStateT } from "~/components/AI/hooks/useAiFetchRequestInit";
import { compareSignatures, createSignatureMap } from "~/components/AI/hooks/utils";
import type { ParamDef, WidgetT } from "~/components/types";
import type { Selector } from "./app";
import type { Copilot, CopilotWidget, DataContent, WidgetSignature } from "./copilot";

export type WidgetDataMetadata = {
  params?: Record<string, unknown>;
  options?: Record<string, NonNullable<ParamDef["options"]>>;
  columns?: string[];
  param_sync?: unknown;
  [key: string]: unknown;
};

export interface DashboardWidgetData {
  title?: string;
  innerTab?: string;
  description?: string;
  endpointUrl?: string;
  metadata?: WidgetDataMetadata;
  data?: unknown;
  storage?: Record<string, unknown>;
  dashboardId?: string;
  captureExecutedParams?: boolean;
}

export interface WidgetData extends DashboardWidgetData {
  ticker: string;
  source: string;
  widgetId: string;
}

export interface WidgetSubsetData {
  uuid: string;
  name: string;
  description?: string;
  metadata: Record<string, unknown>;
  data?: DataContent;
}

export type CopilotWidgets = {
  selectedWidgets: CopilotWidget[];
  dashboardWidgets: CopilotWidget[];
  allDashboardWidgets: CopilotWidget[];
  temporaryWidgets: CopilotWidget[];
  allWidgets: CopilotWidget[];
  workspaceState?: WorkspaceStateT;
};

export type CopilotWidgetRuntimeState = {
  copilotDraftParams?: Record<string, unknown>;
  copilotExecutedParams?: Record<string, unknown>;
  copilotPendingParams?: Record<string, unknown>;
  [key: string]: unknown;
};

const defaultState = {
  copilotWidgets: {
    selectedWidgets: [],
    dashboardWidgets: [],
    allDashboardWidgets: [],
    temporaryWidgets: [],
    allWidgets: [],
  },
  copilotWidgetsLastUpdated: 0,
  signaturesMap: {},
  widgetsLastUpdated: 0,
  widgetsInCurrentDashboard: [],
  dashboardWidgetsData: {},
  widgetSubsetData: [],
  selectedWidgetIDs: [],
  mentionTrackedWidgetUuids: new Set<string>(),
  preSelectedWidgetUuids: new Set<string>(),
  widgetRuntimeState: new Map<string, CopilotWidgetRuntimeState>(),
} as CopilotDataState;

const CopilotFeatureMapping = {
  selectedWidgets: "widget-dashboard-select",
  temporaryWidgets: "file-upload",
  allWidgets: "widget-global-search",
} as const;

interface CopilotDataState {
  copilotWidgets: CopilotWidgets;
  copilotWidgetsLastUpdated: number;
  signaturesMap: Record<string, WidgetSignature>;
  widgetsLastUpdated: number;
  widgetsInCurrentDashboard: WidgetT[];
  dashboardWidgetsData: Record<string, DashboardWidgetData>; // used for function calling
  widgetSubsetData: WidgetSubsetData[]; // new state for storing subset data
  selectedWidgetIDs: string[]; // selected widgets (widgets added as context)
  mentionTrackedWidgetUuids: Set<string>; // widgets added via @ mentions
  preSelectedWidgetUuids: Set<string>; // widgets that were selected before being mentioned
  widgetRuntimeState: Map<string, CopilotWidgetRuntimeState>; // runtime state for widgets (like fileOptions for multi-file viewer)
}

export interface CopilotDataStore extends CopilotDataState {
  getCopilotWidgets: (targetAgend?: Copilot) => CopilotWidgets;
  setCopilotWidgets: (widgets: Partial<CopilotWidgets>) => void;
  updateSignaturesMap: () => Promise<void>;
  getWidgetFromSignature: (signature: WidgetSignature) => WidgetT | null | undefined;
  checkWidgetSignature: (uuid: string, signature: WidgetSignature) => boolean;
  debounceUpdateSignaturesMap: () => Promise<void> | undefined;
  getWidgetsInCurrentDashboard: (uuid?: string) => WidgetT | WidgetT[] | undefined;
  setWidgetsInCurrentDashboard: (widgets: WidgetT[]) => void;
  /* Dashboard widgets data */
  getDashboardWidgetData: (uuid?: string) => DashboardWidgetData | undefined; // get data for a specific widget
  getDashboardWidgetsData: () => Record<string, DashboardWidgetData> | null; // get data for all widgets
  addDataOnDashboardWidget: (widgetId: string, data: DashboardWidgetData) => void;
  setWidgetCopilotDraftParams: (
    widgetId: string,
    draftParams: Record<string, unknown>,
  ) => void;
  beginWidgetCopilotExecution: (
    widgetId: string,
    submittedParams: Record<string, unknown>,
  ) => void;
  removeDataFromDashboardWidget: (widgetId: string, checkData?: boolean) => void; // new action for removing data from dashboard widget
  /* Widget subset data */
  addWidgetSubsetData: (uuid: string, content: string) => void; // new action for adding subset data
  removeWidgetSubsetData: (widgetSusbetId: string) => void; // new action for removing subset data
  clearWidgetSubsetData: () => void; // new action for clearing subset data
  /* Selected widgets */
  getSelectedWidgetsData: () => Record<string, DashboardWidgetData>; // get all selected widgets data
  removeWidgetSelected: (widgetId: string) => void; // remove widget from selected widgets
  isWidgetSelected: (widgetId: string) => boolean; // check if widget is selected
  toggleSelectedWidget: (uuid: string) => void; // remove or add widget to selected widgets
  clearSelectedWidgets: () => void; // clear all selected widgets
  extraWidgetsEnabled: boolean;
  toggleExtraWidgetsEnabled: () => boolean;
  generativeUiEnabled: boolean;
  toggleGenerativeUiEnabled: () => boolean;
  /* Mention tracking */
  setMentionTrackedWidgets: (uuids: string[]) => void; // set mention-tracked widgets
  addMentionTrackedWidget: (uuid: string) => void; // add widget to mention tracking
  removeMentionTrackedWidget: (uuid: string) => void; // remove widget from mention tracking
  clearMentionTrackedWidgets: () => void; // clear all mention-tracked widgets
  isMentionTrackedWidget: (uuid: string) => boolean; // check if widget is mention-tracked
  /* Pre-selected widgets */
  addPreSelectedWidget: (uuid: string) => void; // mark widget as pre-selected
  removePreSelectedWidget: (uuid: string) => void; // remove widget from pre-selected tracking
  isPreSelectedWidget: (uuid: string) => boolean; // check if widget was pre-selected
  clearState: () => void; // clear all state related to copilot data
  removeWidgetData: (uuid: string) => void; // clear all data related to a specific widget
  removeTabWidgetsData: (widgetIds: string[]) => void; // clear all data related to a list of widgets
  /* Widget runtime state */
  setWidgetRuntimeState: (widgetId: string, state: CopilotWidgetRuntimeState) => void; // set runtime state for a widget
  getWidgetRuntimeState: (widgetId: string) => CopilotWidgetRuntimeState | undefined; // get runtime state for a widget
  clearWidgetRuntimeState: (widgetId: string) => void; // clear runtime state for a widget
}

export const useCopilotDataStore = createWithEqualityFn<CopilotDataStore>()(
  subscribeWithSelector(
    persist(
      (set, get: () => CopilotDataStore) => ({
        ...defaultState,

        updateSignaturesMap: async () => {
          const { dashboardWidgetsData, widgetsInCurrentDashboard } = get();
          const signaturesMap = createSignatureMap(
            widgetsInCurrentDashboard,
            dashboardWidgetsData,
          );
          set({ signaturesMap });
        },
        debounceUpdateSignaturesMap: debounce(async () => {
          get().updateSignaturesMap();
        }, 250),
        getWidgetFromSignature: (signature) => {
          const { widgetsInCurrentDashboard, signaturesMap } = get();
          return widgetsInCurrentDashboard.find((widget) =>
            compareSignatures(signaturesMap[widget.id], signature),
          );
        },
        checkWidgetSignature: (uuid, signature) => {
          if (!(uuid && signature)) return false;
          return compareSignatures(get().signaturesMap[uuid], signature);
        },
        setWidgetsInCurrentDashboard: (widgets) => {
          set({ widgetsInCurrentDashboard: widgets });
          get().debounceUpdateSignaturesMap();
          setTimeout(() => {
            set({ widgetsLastUpdated: Date.now() });
          }, 300);
        },
        getWidgetsInCurrentDashboard: (uuid) => {
          const { widgetsInCurrentDashboard } = get();
          if (uuid) {
            return widgetsInCurrentDashboard.find((widget) => widget.id === uuid);
          }
          return widgetsInCurrentDashboard;
        },
        setCopilotWidgets: (widgets) =>
          set((state) => ({
            copilotWidgets: { ...state.copilotWidgets, ...widgets },
            copilotWidgetsLastUpdated: Date.now(),
          })),
        getCopilotWidgets: (targetAgent) => {
          if (!targetAgent) return get().copilotWidgets;
          const features = targetAgent?.features || {};

          const copilotWidgets = cloneDeep(get().copilotWidgets);
          for (const key of Object.keys(
            CopilotFeatureMapping,
          ) as (keyof typeof CopilotFeatureMapping)[]) {
            if (!features[CopilotFeatureMapping[key]]) copilotWidgets[key] = [];
          }

          if (!features["widget-dashboard-select"]) {
            copilotWidgets.allDashboardWidgets = [];
            copilotWidgets.dashboardWidgets = [];
            if (copilotWidgets.workspaceState) {
              copilotWidgets.workspaceState.current_dashboard_info = null;
            }
          }

          return copilotWidgets;
        },
        getDashboardWidgetData: (uuid) => {
          if (uuid) return get().dashboardWidgetsData[uuid];
        },
        getDashboardWidgetsData: () => {
          return get().dashboardWidgetsData;
        },
        getSelectedWidgetsData: () => {
          const { dashboardWidgetsData, selectedWidgetIDs } = get();
          return selectedWidgetIDs.reduce(
            (acc, widgetId) => {
              acc[widgetId] = dashboardWidgetsData[widgetId];
              return acc;
            },
            {} as Record<string, DashboardWidgetData>,
          );
        },
        isWidgetSelected: (widgetId) => get()?.selectedWidgetIDs?.includes(widgetId),
        removeWidgetSelected: (widgetId) =>
          set((state) => ({
            ...state,
            selectedWidgetIDs: state.selectedWidgetIDs.filter(
              (key) => key !== widgetId,
            ),
          })),
        toggleSelectedWidget: (uuid) => {
          const isSelected = get().selectedWidgetIDs.includes(uuid);
          if (!isSelected) {
            document.getElementById("expand-copilot-btn")?.click();
            document.getElementById("expand-copilot-mobile-btn")?.click();
          }
          setTimeout(() => {
            set((state) => ({
              ...state,
              selectedWidgetIDs: isSelected
                ? state.selectedWidgetIDs.filter((key) => key !== uuid)
                : [...state.selectedWidgetIDs, uuid],
            }));
          }, 100);
        },
        clearSelectedWidgets: () => set({ selectedWidgetIDs: [] }),
        /**
         * Stores widget data for copilot context and optionally promotes pending params.
         *
         * When `captureExecutedParams` is true and data is present, promotes `copilotPendingParams`
         * to `copilotExecutedParams`. This ensures the copilot sees the actual params used to
         * fetch the data, not potentially stale draft params.
         */
        addDataOnDashboardWidget: (widgetId, data) => {
          set((state) => {
            const nextState = {
              ...state,
              dashboardWidgetsData: {
                ...state.dashboardWidgetsData,
                [widgetId]: data,
              },
            } as CopilotDataState;

            if (
              data.captureExecutedParams !== true ||
              !("data" in data) ||
              data.data === undefined ||
              data.data === null
            ) {
              return nextState;
            }

            const currentRuntimeState = state.widgetRuntimeState.get(widgetId) || {};
            const pendingParams = currentRuntimeState.copilotPendingParams;
            if (!pendingParams) return nextState;

            const nextRuntimeState = {
              ...currentRuntimeState,
              copilotExecutedParams: { ...pendingParams },
              copilotPendingParams: undefined,
            };

            if (isEqual(currentRuntimeState, nextRuntimeState)) return nextState;

            const newRuntimeState = new Map(state.widgetRuntimeState);
            newRuntimeState.set(widgetId, nextRuntimeState);
            nextState.widgetRuntimeState = newRuntimeState;
            return nextState;
          });
          get().debounceUpdateSignaturesMap();
          setTimeout(() => {
            set({ widgetsLastUpdated: Date.now() });
          }, 300);
        },
        /**
         * Updates the draft parameters for a widget's copilot context.
         *
         * Draft params represent what the user is currently editing in the UI (e.g., typing
         * a query). These are shown as `current_value` in copilot context, distinct from
         * `executed_value` which reflects the last successfully executed params.
         */
        setWidgetCopilotDraftParams: (widgetId, draftParams) =>
          set((prev) => {
            const currentRuntimeState = prev.widgetRuntimeState.get(widgetId) || {};
            const nextRuntimeState = {
              ...currentRuntimeState,
              copilotDraftParams: {
                ...(currentRuntimeState.copilotDraftParams || {}),
                ...draftParams,
              },
            };

            if (isEqual(currentRuntimeState, nextRuntimeState)) return prev;

            const newRuntimeState = new Map(prev.widgetRuntimeState);
            newRuntimeState.set(widgetId, nextRuntimeState);

            return {
              ...prev,
              widgetRuntimeState: newRuntimeState,
              widgetsLastUpdated: Date.now(),
            };
          }),
        /**
         * Stores the submitted params as pending for copilot param reconciliation.
         *
         * When the execution completes and `addDataOnDashboardWidget` is called with
         * `captureExecutedParams: true`, the pending params are promoted to `copilotExecutedParams`.
         */
        beginWidgetCopilotExecution: (widgetId, submittedParams) => {
          set((prev) => {
            const currentRuntimeState = prev.widgetRuntimeState.get(widgetId) || {};
            const nextRuntimeState = {
              ...currentRuntimeState,
              copilotPendingParams: { ...(submittedParams || {}) },
            };

            if (isEqual(currentRuntimeState, nextRuntimeState)) return prev;

            const newRuntimeState = new Map(prev.widgetRuntimeState);
            newRuntimeState.set(widgetId, nextRuntimeState);

            return {
              ...prev,
              widgetRuntimeState: newRuntimeState,
            };
          });
        },
        removeDataFromDashboardWidget: (widgetId, checkData = false) => {
          set((state) => {
            if (Object.keys(state.dashboardWidgetsData).includes(widgetId)) {
              const newDashboardWidgetsData = { ...state.dashboardWidgetsData };
              // If checkData is true, we only remove the widget if it has no data
              if (checkData && state.dashboardWidgetsData[widgetId]?.data) return state;
              delete newDashboardWidgetsData[widgetId];
              return {
                ...state,
                dashboardWidgetsData: newDashboardWidgetsData,
              };
            }
            return state;
          });
          get().debounceUpdateSignaturesMap();
          setTimeout(() => {
            set({ widgetsLastUpdated: Date.now() });
          }, 300);
        },
        addWidgetSubsetData: (uuid: string, content: string) => {
          document.getElementById("expand-copilot-btn")?.click();

          const {
            title: name,
            description,
            metadata,
          } = get().dashboardWidgetsData[uuid];

          set((state) => ({
            ...state,
            widgetSubsetData: [
              ...state.widgetSubsetData,
              {
                uuid,
                name: name ?? "",
                description,
                metadata: metadata ?? {},
                data: { content: content },
              },
            ],
          }));
        },
        removeWidgetSubsetData: (content: string) =>
          // TODO: Remove widget by subset uuid instead
          set((state) => ({
            ...state,
            widgetSubsetData: state.widgetSubsetData.filter(
              (item) => item.data?.content !== content,
            ),
          })),
        clearWidgetSubsetData: () => set({ widgetSubsetData: [] }),
        extraWidgetsEnabled: false,
        toggleExtraWidgetsEnabled: () => {
          const { extraWidgetsEnabled } = get();
          set((state) => ({
            ...state,
            extraWidgetsEnabled: !extraWidgetsEnabled,
          }));
          return !extraWidgetsEnabled;
        },
        generativeUiEnabled: false,
        toggleGenerativeUiEnabled: () => {
          const { generativeUiEnabled } = get();
          set((state) => ({
            ...state,
            generativeUiEnabled: !generativeUiEnabled,
          }));

          return !generativeUiEnabled;
        },
        setMentionTrackedWidgets: (uuids: string[]) =>
          set((state) => ({
            ...state,
            mentionTrackedWidgetUuids: new Set(uuids),
          })),
        addMentionTrackedWidget: (uuid: string) =>
          set((state) => ({
            ...state,
            mentionTrackedWidgetUuids: new Set([
              ...state.mentionTrackedWidgetUuids,
              uuid,
            ]),
          })),
        removeMentionTrackedWidget: (uuid: string) =>
          set((state) => {
            const newSet = new Set(state.mentionTrackedWidgetUuids);
            newSet.delete(uuid);
            return {
              ...state,
              mentionTrackedWidgetUuids: newSet,
            };
          }),
        clearMentionTrackedWidgets: () =>
          set((state) => ({
            ...state,
            mentionTrackedWidgetUuids: new Set<string>(),
          })),
        isMentionTrackedWidget: (uuid: string) =>
          get().mentionTrackedWidgetUuids.has(uuid),
        addPreSelectedWidget: (uuid: string) =>
          set((state) => ({
            ...state,
            preSelectedWidgetUuids: new Set([...state.preSelectedWidgetUuids, uuid]),
          })),
        removePreSelectedWidget: (uuid: string) =>
          set((state) => {
            const newSet = new Set(state.preSelectedWidgetUuids);
            newSet.delete(uuid);
            return {
              ...state,
              preSelectedWidgetUuids: newSet,
            };
          }),
        isPreSelectedWidget: (uuid: string) => get().preSelectedWidgetUuids.has(uuid),
        clearState: () =>
          set((state) => ({
            ...defaultState,
            mentionTrackedWidgetUuids: state.mentionTrackedWidgetUuids,
          })),
        removeWidgetData: (uuid: string) => {
          get().removeDataFromDashboardWidget(uuid);
          get().removeWidgetSubsetData(uuid);
          get().removeWidgetSelected(uuid);
          get().removeMentionTrackedWidget(uuid);
          get().removePreSelectedWidget(uuid);
          get().clearWidgetRuntimeState(uuid);
        },
        removeTabWidgetsData: (widgetIds: string[]) => {
          for (const widgetId of widgetIds) get().removeWidgetData(widgetId);
        },
        setWidgetRuntimeState: (widgetId: string, state: CopilotWidgetRuntimeState) =>
          set((prev) => {
            const newRuntimeState = new Map(prev.widgetRuntimeState);
            newRuntimeState.set(widgetId, state);
            return { ...prev, widgetRuntimeState: newRuntimeState };
          }),
        getWidgetRuntimeState: (widgetId: string) =>
          get().widgetRuntimeState.get(widgetId),
        clearWidgetRuntimeState: (widgetId: string) =>
          set((prev) => {
            const newRuntimeState = new Map(prev.widgetRuntimeState);
            newRuntimeState.delete(widgetId);
            return { ...prev, widgetRuntimeState: newRuntimeState };
          }),
      }),
      {
        name: "copilot-data",
        partialize: (state) => ({
          extraWidgetsEnabled: state.extraWidgetsEnabled,
          generativeUiEnabled: state.generativeUiEnabled,
        }),
      },
    ),
  ),
  shallow,
);

export function useShallowCopilotDataStore<T>(
  selector: Selector<CopilotDataStore, T>,
): T {
  return useCopilotDataStore(useShallow(selector), (prev, next) => isEqual(prev, next));
}
