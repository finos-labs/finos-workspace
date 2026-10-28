import * as TabsPrimitive from "@radix-ui/react-tabs";
import { DeploymentTab } from "~/components/AdminPlugins/DeploymentTab";
import { EntityPluginsTab } from "~/components/AdminPlugins/EntityPluginsTab";
import { SettingsLayout } from "~/components/LayoutAuth/Skeleton/SettingsLayout";
import { useIsEntityAdmin } from "~/hooks/useEntityAdmin";
import { WidgetVizTypes } from "~/lib/types/app";

const CORE_DESCRIPTIONS: Record<string, string> = {
  markdown: "Markdown text from a backend endpoint",
  html: "HTML from a backend endpoint",
  iframe: "An existing web page, embedded",
  newsfeed: "A list of articles",
  pdf: "A PDF document",
};

export default function AdminWidgets() {
  const { isEntityAdmin: isSuperuser } = useIsEntityAdmin();
  const tabs = [
    { label: "Plugin widgets", id: "plugins", disabled: false },
    { label: "Core widgets", id: "core", disabled: false },
    ...(isSuperuser
      ? [{ label: "Deployment", id: "deployment", disabled: false }]
      : []),
  ];

  return (
    <SettingsLayout
      title="Widgets"
      description="Core widget types are part of the FINOS Workspace. Plugin widgets come from packages the deployer placed on the server; each is off until approved and enabled."
      tabs={tabs}
      defaultTab="plugins"
    >
      <TabsPrimitive.Content value="plugins" className="px-6 py-6 outline-none">
        <EntityPluginsTab />
      </TabsPrimitive.Content>
      <TabsPrimitive.Content value="core" className="px-6 py-6 outline-none">
        <ul className="flex flex-col gap-3 body-xs-regular">
          {WidgetVizTypes.map((type) => (
            <li key={type}>
              <span className="body-xs-medium">{type}</span>
              <span className="text-ds-text-body">
                : {CORE_DESCRIPTIONS[type] ?? ""}
              </span>
            </li>
          ))}
        </ul>
      </TabsPrimitive.Content>
      {isSuperuser && (
        <TabsPrimitive.Content value="deployment" className="px-6 py-6 outline-none">
          <DeploymentTab />
        </TabsPrimitive.Content>
      )}
    </SettingsLayout>
  );
}
