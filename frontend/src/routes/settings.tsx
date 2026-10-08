import * as TabsPrimitive from "@radix-ui/react-tabs";
import { useMutation } from "@tanstack/react-query";
import { useMemo } from "react";
import { toast } from "sonner";
import { useUpdateEffect } from "usehooks-ts";
import { SettingsLayout } from "~/components/LayoutAuth/Skeleton/SettingsLayout";
import AdvancedTab from "~/components/Settings/AdvancedTab";
import GeneralTab from "~/components/Settings/GeneralTab";
import LayoutTab from "~/components/Settings/LayoutTab";
import SecurityTab from "~/components/Settings/SecurityTab";
import WidgetTab from "~/components/Settings/WidgetTab";
import { getConfig } from "~/lib/runtimeConfig";
import { useShallowAppStore } from "~/lib/state/app";
import { useShallowAuthStore } from "~/lib/state/auth";
import { useShallowFeatureFlagsStore } from "~/lib/state/featureFlags";
import { useShallowThemeStore } from "~/lib/state/theme";
import { getHeaders } from "~/lib/utils/fetch";
import type { DisplaySettings } from "~/types/auth.type";

export function useSaveSettings(notify = true) {
  const displaySettings = useShallowThemeStore((state) => state.getDisplaySettings());

  const userToken = useShallowAuthStore((state) => state.user?.token);
  const hasItems = useShallowAppStore((state) => state.hasItems || !!state.rootItem);

  const { mutateAsync: saveSettings } = useMutation({
    mutationFn: async (data: DisplaySettings) => {
      return fetch(`${getConfig().urls.backend}/app/display-settings`, {
        method: "POST",
        body: JSON.stringify(data),
        headers: getHeaders(userToken ?? ""),
      });
    },
    onSuccess: (response) => {
      if (!notify) return;
      if (response.ok) {
        toast.success("Display settings updated", {
          id: "display-settings",
          description: "Your display settings have been updated successfully",
          duration: 1000,
        });
      } else {
        toast.error("Error updating settings", {
          id: "display-settings",
          description: "Your display settings were not updated",
        });
      }
    },
    onError: () => {
      if (!notify) return;
      toast.error("Error updating settings", {
        id: "display-settings",
        description: "Your display settings were not updated",
      });
    },
  });

  useUpdateEffect(() => {
    if (!hasItems) return;
    saveSettings(displaySettings);
  }, [displaySettings]);
}
export default function Settings() {
  const featureFlags = useShallowFeatureFlagsStore((state) => state.featureFlags);
  const isFullTier = featureFlags?.tier === "full";

  const TABS = useMemo(
    () => [
      { label: "General", id: "general" },
      { label: "Layout", id: "tab-layout" },
      { label: "Widget", id: "widget" },
      { label: "Advanced", id: "advanced" },
      { label: "Security", id: "security", disabled: !isFullTier },
    ],
    [isFullTier],
  );

  useSaveSettings();

  return (
    <SettingsLayout title="Settings" tabs={TABS} defaultTab="general">
      <TabsPrimitive.Content value="general" className="px-6 text-xs only-sm:h-screen">
        <GeneralTab />
      </TabsPrimitive.Content>
      <TabsPrimitive.Content
        value="tab-layout"
        className="px-6 text-xs only-sm:h-screen"
      >
        <LayoutTab />
      </TabsPrimitive.Content>
      <TabsPrimitive.Content value="widget" className="px-6 text-xs only-sm:h-screen">
        <WidgetTab />
      </TabsPrimitive.Content>
      <TabsPrimitive.Content value="advanced" className="px-6 text-xs only-sm:h-screen">
        <AdvancedTab />
      </TabsPrimitive.Content>
      {isFullTier && (
        <TabsPrimitive.Content
          value="security"
          className="px-6 text-xs only-sm:h-screen"
        >
          <SecurityTab />
        </TabsPrimitive.Content>
      )}
    </SettingsLayout>
  );
}
