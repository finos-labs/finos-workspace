import * as TabsPrimitive from "@radix-ui/react-tabs";
import { useEffect } from "react";
import { SettingsLayout } from "~/components/LayoutAuth/Skeleton/SettingsLayout";
import { GroupingSettings } from "~/components/ThemeSettings/GroupingSettings";
import { useShallowEntityThemeStore } from "~/lib/state/entityTheme";

const TABS = [{ label: "Grouping", id: "grouping" }];

export default function AdminThemeSettings() {
  const updateThemeSettings = useShallowEntityThemeStore(
    (state) => state.updateThemeSettings,
  );

  useEffect(() => {
    // Fetch most recent theme settings
    updateThemeSettings();
  }, []);

  return (
    <SettingsLayout title="Theme Settings" tabs={TABS} defaultTab="grouping">
      <TabsPrimitive.Content
        value="grouping"
        className="p-6 text-sm only-sm:h-screen flex flex-col flex-1"
      >
        <GroupingSettings />
      </TabsPrimitive.Content>
    </SettingsLayout>
  );
}
