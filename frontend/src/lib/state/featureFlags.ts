import isEqual from "lodash.isequal";
import { subscribeWithSelector } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import { createWithEqualityFn } from "zustand/traditional";
import { shallow } from "zustand/vanilla/shallow";
import type { Selector } from "./app";

/* example of what is returned from backend on /login
feature_entitlements: {
    "tier": "full",
    "number_copilot_calls_day": 100,
    "number_copilot_tokens_day": null,
    "total_file_upload_size_gb": 50,
    "share_widgets": "private",
    "bring_your_own_data": true,
    "bring_your_own_copilot": true,
    "admin_access": true,
    "support": true,
    "excel_add_in": true,
    "data_add_ons_redistribution": true,
    "bundle_name": null,
    "data_bundle_info": null
}
*/

export type FeatureFlags = {
  admin_access: boolean; // show admin panel
  bring_your_own_copilot: boolean;
  bring_your_own_data: boolean;
  bundle_name: string | null;
  data_add_ons_redistribution: boolean;
  data_bundle_info: DataBundle | null;
  excel_add_in: boolean;
  number_copilot_calls_day: number;
  number_copilot_tokens_day: number | null; // null: no token limit
  share_widgets: "private" | "public";
  support: boolean;
  tier: "full" | "basic";
  total_file_upload_size_gb: number;
  can_submit_marketplace: boolean; // developer may submit marketplace apps
};

export function isExcludedWidgetId(widgetId: string | undefined): boolean {
  const featureFlags = useFeatureFlagsStore.getState().featureFlags;
  return (
    widgetId !== undefined &&
    (featureFlags?.data_bundle_info?.except_widgets?.includes(widgetId) ?? false)
  );
}

export type DataBundle = {
  bundle_name: "Default" | "Equity Research";
  except_widgets: string[] | null;
  except_dashboard_templates: string[] | null;
  except_team_collaboration: ("pdf_reports" | "sharing")[] | null;
  excel_add_in: boolean;
  data_export: boolean;
  providers: string[] | null;
  dashboards_at_launch: string[] | null;
  my_dashboards: string[] | null;
  invite_your_colleagues: boolean;
  number_copilot_calls_day: number;
  total_file_upload_size_gb: number;
};

export type Usage = {
  number_copilot_calls_day_count: number;
  number_copilot_tokens_day_count: number;
  total_file_upload_size_gb_count: number;
  copilot_calls_limit: number;
  copilot_tokens_limit: number | null; // null: no token limit
  file_upload_size_limit: number;
};

type FeatureFlagsState = {
  featureFlags: FeatureFlags | null;
  setFeatureFlags: (flags: Partial<FeatureFlags>) => void;
  usage: Usage | null;
  setUsage: (usage: Usage) => void;
  updateFeatureFlagsAndUsage: (
    flags: Partial<FeatureFlags>,
    usage: Partial<Usage>,
  ) => void;
  setFeatureFlagsAndUsage: (flags: FeatureFlags, usage: Usage | null) => void;
};

export const useFeatureFlagsStore = createWithEqualityFn<FeatureFlagsState>()(
  subscribeWithSelector((set) => ({
    featureFlags: null,
    usage: null,
    setUsage: (usage) =>
      set((state) => ({ usage: { ...state.usage, ...usage } as Usage })),
    setFeatureFlags: (flags) =>
      set((state) => ({
        featureFlags: { ...state.featureFlags, ...flags } as FeatureFlags,
      })),
    updateFeatureFlagsAndUsage: (flags, usage) =>
      set((state) => ({
        featureFlags: { ...state.featureFlags, ...flags } as FeatureFlags,
        usage: { ...state.usage, ...usage } as Usage,
      })),
    setFeatureFlagsAndUsage: (flags, usage) =>
      set(() => ({
        featureFlags: flags,
        usage: usage,
      })),
  })),
  shallow,
);

export function useShallowFeatureFlagsStore<T>(
  selector: Selector<FeatureFlagsState, T>,
): T {
  return useFeatureFlagsStore(useShallow(selector), (prev, next) =>
    isEqual(prev, next),
  );
}
