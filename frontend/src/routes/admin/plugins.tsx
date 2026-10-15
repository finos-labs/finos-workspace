/**
 * Route /admin/plugins (Admin Portal). Lists the plugins from the plugin host's registry
 * as cards, with loading, empty, error/retry and "not configured" states, and lets an
 * administrator enable or disable each plugin for all users and dashboards.
 */
import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ds/atoms/Button";
import { Notice } from "~/components/ds/molecules/Notice";
import SearchResultsNotFound from "~/components/General/SearchResultsNotFound";
import { SettingsLayout } from "~/components/LayoutAuth/Skeleton/SettingsLayout";
import { PluginCard } from "~/components/Plugins/PluginCard";
import { usePluginEnablement, usePlugins } from "~/hooks/usePluginManager";
import type { PluginMetadata } from "~/lib/plugins";

const TABS = [{ label: "All Plugins", id: "all-plugins" }];

export default function PluginsPage() {
  const { manager, data, error, isLoading, isFetching, refetch } = usePlugins();
  const enablement = usePluginEnablement(manager);

  const retry = () => {
    manager.refresh();
    refetch();
  };

  const setEnabled = async (plugin: PluginMetadata, enabled: boolean) => {
    try {
      await enablement.setPluginEnabled({ pluginId: plugin.id, enabled });
      toast.success(`${plugin.name} ${enabled ? "enabled" : "disabled"} for all users`);
    } catch (setError) {
      toast.error(
        setError instanceof Error
          ? setError.message
          : `Could not update ${plugin.name}`,
      );
    }
  };

  let content: ReactNode;
  if (manager.host.ok === false) {
    content = (
      <Notice variant="warning" title="Plugins are not configured">
        {manager.host.message}
      </Notice>
    );
  } else if (isLoading || enablement.isLoading) {
    content = (
      <div
        role="status"
        aria-label="Loading plugins"
        className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-4"
      >
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="h-[178px] rounded border border-general-border-secondary bg-general-bg-secondary animate-pulse"
          />
        ))}
      </div>
    );
  } else if (error || enablement.error) {
    content = (
      <Notice variant="error" title="Could not load plugins">
        <span className="flex flex-col items-start gap-2">
          {(error ?? enablement.error)?.message}
          <Button variant="outlined" size="xs" onClick={retry} loading={isFetching}>
            Retry
          </Button>
        </span>
      </Notice>
    );
  } else if (!data?.plugins.length) {
    content = (
      <SearchResultsNotFound
        extraClassName="dark:bg-dark-800 bg-light-50 py-40 rounded"
        icon={true}
        firstMessage="No plugins available"
        secondMessage="The plugin registry is empty."
      />
    );
  } else {
    content = (
      <>
        {data.errors.length > 0 && (
          <Notice variant="warning" title="Some registry entries were skipped">
            {data.errors.join(" ")}
          </Notice>
        )}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-4">
          {data.plugins.map((plugin) => (
            <PluginCard
              key={plugin.id}
              plugin={plugin}
              enabled={enablement.enabledIds.has(plugin.id)}
              updating={enablement.pendingPluginId === plugin.id}
              onOpen={(selected) => manager.openPlugin(selected.id)}
              onToggleEnabled={setEnabled}
            />
          ))}
        </div>
      </>
    );
  }

  return (
    <SettingsLayout
      title="Plugins"
      description="BrightQuery plugins served by the configured plugin host. Enabled plugins are available to all users and dashboards."
      tabs={TABS}
      defaultTab="all-plugins"
    >
      <TabsPrimitive.Content value="all-plugins" className="p-6 flex flex-col gap-4">
        {content}
      </TabsPrimitive.Content>
    </SettingsLayout>
  );
}
