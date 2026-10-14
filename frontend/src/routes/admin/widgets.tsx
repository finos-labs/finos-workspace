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

/**
 * Widgets (docs/widget-plugins/DESIGN.md 8.1): the core widget types, listed apart from
 * the plugin widgets your organization enables, and, for superusers, the packages on the
 * server to review.
 */
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
      description="Core widget types are part of the Workspace. Plugin widgets come from packages the deployer placed on the server; each is off until approved and enabled."
      tabs={tabs}
      defaultTab="plugins"
    >
      <TabsPrimitive.Content value="plugins" className="outline-none">
        <EntityPluginsTab />
      </TabsPrimitive.Content>
      <TabsPrimitive.Content value="core" className="outline-none">
        <ul className="flex flex-col gap-1 body-xs-regular">
          {WidgetVizTypes.map((type) => (
            <li key={type}>
              <span className="body-xs-medium">{type}</span>:{" "}
              {CORE_DESCRIPTIONS[type] ?? ""}
            </li>
          ))}
        </ul>
      </TabsPrimitive.Content>
      {isSuperuser && (
        <TabsPrimitive.Content value="deployment" className="outline-none">
          <DeploymentTab />
        </TabsPrimitive.Content>
      )}
    </SettingsLayout>
  );
}
