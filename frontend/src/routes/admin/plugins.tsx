/**
 * Route /admin/plugins (Admin Portal). Lists the plugins from the plugin host's registry
 * as cards, with loading, empty, error/retry and "not configured" states, and lets an
 * administrator enable (approve a released version of) or disable each plugin for all
 * users and dashboards, and review a newer or changed release before approving it.
 */
import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ds/atoms/Button";
import { Notice } from "~/components/ds/molecules/Notice";
import SearchResultsNotFound from "~/components/General/SearchResultsNotFound";
import { SettingsLayout } from "~/components/LayoutAuth/Skeleton/SettingsLayout";
import { PluginCard } from "~/components/Plugins/PluginCard";
import { usePluginApprovals, usePlugins } from "~/hooks/usePluginManager";
import type { PluginMetadata } from "~/lib/plugins";

const TABS = [{ label: "All Plugins", id: "all-plugins" }];

export default function PluginsPage() {
  const { manager, data, error, isLoading, isFetching, refetch } = usePlugins();
  const approvals = usePluginApprovals(manager);

  const retry = () => {
    manager.refresh();
    refetch();
  };

  const run = async (
    action: () => Promise<unknown>,
    done: string,
    plugin: PluginMetadata,
  ) => {
    try {
      await action();
      toast.success(done);
    } catch (setError) {
      toast.error(
        setError instanceof Error
          ? setError.message
          : `Could not update ${plugin.name}`,
      );
    }
  };

  const approve = (plugin: PluginMetadata, version: string) =>
    run(
      () => approvals.approveRelease({ pluginId: plugin.id, version }),
      `${plugin.name} ${version} approved for all users`,
      plugin,
    );
  const disable = (plugin: PluginMetadata) =>
    run(
      () => approvals.disablePlugin({ pluginId: plugin.id }),
      `${plugin.name} disabled for all users`,
      plugin,
    );

  let content: ReactNode;
  if (manager.host.ok === false) {
    content = (
      <Notice variant="warning" title="Plugins are not configured">
        {manager.host.message}
      </Notice>
    );
  } else if (isLoading || approvals.isLoading) {
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
  } else if (error || approvals.error) {
    content = (
      <Notice variant="error" title="Could not load plugins">
        <span className="flex flex-col items-start gap-2">
          {(error ?? approvals.error)?.message}
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
              state={approvals.stateFor(plugin.id)}
              updating={approvals.pendingPluginId === plugin.id}
              onOpen={(selected) => manager.openPlugin(selected.id)}
              onApprove={approve}
              onDisable={disable}
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
