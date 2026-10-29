import cloneDeep from "lodash/cloneDeep";
import debounce from "lodash.debounce";
import isEqual from "lodash.isequal";
import { subscribeWithSelector } from "zustand/middleware";
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
  dashboardWidgetsData: Record<string, DashboardWidgetData>;
  widgetSubsetData: WidgetSubsetData[];
  selectedWidgetIDs: string[];
  mentionTrackedWidgetUuids: Set<string>;
  preSelectedWidgetUuids: Set<string>;
  widgetRuntimeState: Map<string, CopilotWidgetRuntimeState>;
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
  getDashboardWidgetData: (uuid?: string) => DashboardWidgetData | undefined;
  getDashboardWidgetsData: () => Record<string, DashboardWidgetData> | null;
  addDataOnDashboardWidget: (widgetId: string, data: DashboardWidgetData) => void;
  setWidgetCopilotDraftParams: (
    widgetId: string,
    draftParams: Record<string, unknown>,
  ) => void;
  beginWidgetCopilotExecution: (
    widgetId: string,
    submittedParams: Record<string, unknown>,
  ) => void;
  removeDataFromDashboardWidget: (widgetId: string, checkData?: boolean) => void;
  addWidgetSubsetData: (uuid: string, content: string) => void;
  removeWidgetSubsetData: (widgetSusbetId: string) => void;
  clearWidgetSubsetData: () => void;
  getSelectedWidgetsData: () => Record<string, DashboardWidgetData>;
  removeWidgetSelected: (widgetId: string) => void;
  isWidgetSelected: (widgetId: string) => boolean;
  toggleSelectedWidget: (uuid: string) => void;
  clearSelectedWidgets: () => void;
  setMentionTrackedWidgets: (uuids: string[]) => void;
  addMentionTrackedWidget: (uuid: string) => void;
  removeMentionTrackedWidget: (uuid: string) => void;
  clearMentionTrackedWidgets: () => void;
  isMentionTrackedWidget: (uuid: string) => boolean;
  addPreSelectedWidget: (uuid: string) => void;
  removePreSelectedWidget: (uuid: string) => void;
  isPreSelectedWidget: (uuid: string) => boolean;
  clearState: () => void;
  removeWidgetData: (uuid: string) => void;
  removeTabWidgetsData: (widgetIds: string[]) => void;
  setWidgetRuntimeState: (widgetId: string, state: CopilotWidgetRuntimeState) => void;
  getWidgetRuntimeState: (widgetId: string) => CopilotWidgetRuntimeState | undefined;
  clearWidgetRuntimeState: (widgetId: string) => void;
}

export const useCopilotDataStore = createWithEqualityFn<CopilotDataStore>()(
  subscribeWithSelector((set, get: () => CopilotDataStore) => ({
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
        selectedWidgetIDs: state.selectedWidgetIDs.filter((key) => key !== widgetId),
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

      const { title: name, description, metadata } = get().dashboardWidgetsData[uuid];

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
      set((state) => ({
        ...state,
        widgetSubsetData: state.widgetSubsetData.filter(
          (item) => item.data?.content !== content,
        ),
      })),
    clearWidgetSubsetData: () => set({ widgetSubsetData: [] }),
    setMentionTrackedWidgets: (uuids: string[]) =>
      set((state) => ({
        ...state,
        mentionTrackedWidgetUuids: new Set(uuids),
      })),
    addMentionTrackedWidget: (uuid: string) =>
      set((state) => ({
        ...state,
        mentionTrackedWidgetUuids: new Set([...state.mentionTrackedWidgetUuids, uuid]),
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
    isMentionTrackedWidget: (uuid: string) => get().mentionTrackedWidgetUuids.has(uuid),
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
    getWidgetRuntimeState: (widgetId: string) => get().widgetRuntimeState.get(widgetId),
    clearWidgetRuntimeState: (widgetId: string) =>
      set((prev) => {
        const newRuntimeState = new Map(prev.widgetRuntimeState);
        newRuntimeState.delete(widgetId);
        return { ...prev, widgetRuntimeState: newRuntimeState };
      }),
  })),
  shallow,
);

export function useShallowCopilotDataStore<T>(
  selector: Selector<CopilotDataStore, T>,
): T {
  return useCopilotDataStore(useShallow(selector), (prev, next) => isEqual(prev, next));
}
