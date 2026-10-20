import * as TabsPrimitive from "@radix-ui/react-tabs";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { useUpdateEffect } from "usehooks-ts";
import { apiClient } from "~/api/api";
import { SettingsLayout } from "~/components/LayoutAuth/Skeleton/SettingsLayout";
import AdvancedTab from "~/components/Settings/AdvancedTab";
import GeneralTab from "~/components/Settings/GeneralTab";
import LayoutTab from "~/components/Settings/LayoutTab";
import SecurityTab from "~/components/Settings/SecurityTab";
import WidgetTab from "~/components/Settings/WidgetTab";
import { useShallowAppStore } from "~/lib/state/app";
import { useShallowThemeStore } from "~/lib/state/theme";
import type { DisplaySettings } from "~/types/auth.type";

export function useSaveSettings(notify = true) {
  const displaySettings = useShallowThemeStore((state) => state.getDisplaySettings());

  const hasItems = useShallowAppStore((state) => state.hasItems || !!state.rootItem);

  const { mutate: saveSettings } = useMutation({
    mutationFn: (data: DisplaySettings) =>
      apiClient.post("/app/display-settings", data),
    onSuccess: () => {
      if (!notify) return;
      toast.success("Display settings updated", {
        id: "display-settings",
        description: "Your display settings have been updated successfully",
        duration: 1000,
      });
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
const TABS = [
  { label: "General", id: "general" },
  { label: "Layout", id: "tab-layout" },
  { label: "Widget", id: "widget" },
  { label: "Advanced", id: "advanced" },
  { label: "Security", id: "security" },
];

export default function Settings() {
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
      <TabsPrimitive.Content value="security" className="px-6 text-xs only-sm:h-screen">
        <SecurityTab />
      </TabsPrimitive.Content>
    </SettingsLayout>
  );
}
