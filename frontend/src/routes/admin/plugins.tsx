/**
 * Route /admin/plugins (Admin Portal). Lists the plugins from the plugin host's registry
 * as cards, with loading, empty, error/retry and "not configured" states.
 * - A super administrator gets a "Catalog" tab with every registry plugin, where they
 *   install (approve a released version of) or uninstall each plugin and review a newer
 *   or changed release before approving it.
 * - Every administrator gets an "Organization" tab with the installed plugins only,
 *   where they enable or disable each for their entity's users and dashboards.
 * Both preview an installed plugin.
 */
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { Navigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "~/components/ds/atoms/Button";
import { Notice } from "~/components/ds/molecules/Notice";
import SearchResultsNotFound from "~/components/General/SearchResultsNotFound";
import { SettingsLayout } from "~/components/LayoutAuth/Skeleton/SettingsLayout";
import { PluginCard } from "~/components/Plugins/PluginCard";
import { useIsEntityAdmin } from "~/hooks/useEntityAdmin";
import { usePluginApprovals, usePlugins } from "~/hooks/usePluginManager";
import type { PluginMetadata } from "~/lib/plugins";

const CATALOG_TAB = { label: "Catalog", id: "catalog" };
const ORGANIZATION_TAB = { label: "Organization", id: "organization" };

const GRID = "grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-4";

function LoadingCards() {
  return (
    <div role="status" aria-label="Loading plugins" className={GRID}>
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="h-[178px] rounded border border-general-border-secondary bg-general-bg-secondary animate-pulse"
        />
      ))}
    </div>
  );
}

export default function PluginsPage() {
  // A superuser installs plugins; the superuser check is the same one Entities uses.
  const { isEntityAdmin: isSuperAdmin, isLoading: checkingRole } = useIsEntityAdmin();
  const { manager, data, error, isLoading, isFetching, refetch } = usePlugins();
  const approvals = usePluginApprovals(manager);
  const [params] = useSearchParams();

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
      approvals.isInstalled(plugin.id)
        ? `${plugin.name} ${version} approved`
        : `${plugin.name} ${version} installed. Administrators can now enable it.`,
      plugin,
    );
  const uninstall = (plugin: PluginMetadata) =>
    run(
      () => approvals.uninstallPlugin({ pluginId: plugin.id }),
      `${plugin.name} uninstalled`,
      plugin,
    );
  const enable = (plugin: PluginMetadata) =>
    run(
      () => approvals.enableForEntity({ pluginId: plugin.id }),
      `${plugin.name} enabled for your organization`,
      plugin,
    );
  const disable = (plugin: PluginMetadata) =>
    run(
      () => approvals.disableForEntity({ pluginId: plugin.id }),
      `${plugin.name} disabled for your organization`,
      plugin,
    );
  const preview = (plugin: PluginMetadata) =>
    manager.openPlugin(plugin.id, { preview: true });

  /** The tab's cards, or why there are none. */
  const renderTab = (mode: "install" | "enable") => {
    if (manager.host.ok === false) {
      return (
        <Notice variant="warning" title="Plugins are not configured">
          {manager.host.message}
        </Notice>
      );
    }
    if (isLoading || approvals.isLoading) return <LoadingCards />;
    if (error || approvals.error) {
      return (
        <Notice variant="error" title="Could not load plugins">
          <span className="flex flex-col items-start gap-2">
            {(error ?? approvals.error)?.message}
            <Button variant="outlined" size="xs" onClick={retry} loading={isFetching}>
              Retry
            </Button>
          </span>
        </Notice>
      );
    }
    if (!data?.plugins.length) {
      return (
        <SearchResultsNotFound
          extraClassName="dark:bg-dark-800 bg-light-50 py-40 rounded"
          icon={true}
          firstMessage="No plugins available"
          secondMessage="The plugin registry is empty."
        />
      );
    }

    const plugins =
      mode === "install"
        ? data.plugins
        : data.plugins.filter((plugin) => approvals.isInstalled(plugin.id));
    if (plugins.length === 0) {
      return (
        <SearchResultsNotFound
          extraClassName="dark:bg-dark-800 bg-light-50 py-40 rounded"
          icon={true}
          firstMessage="No plugins installed"
          secondMessage={
            isSuperAdmin
              ? "Install plugins from the Catalog tab before enabling them here."
              : "A super administrator must install plugins before you can enable them."
          }
        />
      );
    }

    return (
      <>
        {mode === "install" && data.errors.length > 0 && (
          <Notice variant="warning" title="Some registry entries were skipped">
            {data.errors.join(" ")}
          </Notice>
        )}
        <div className={GRID}>
          {plugins.map((plugin) => {
            const shared = {
              plugin,
              state: approvals.stateFor(plugin.id),
              updating: approvals.pendingPluginId === plugin.id,
              onPreview: preview,
            };
            return mode === "install" ? (
              <PluginCard
                key={plugin.id}
                {...shared}
                mode="install"
                onApprove={approve}
                onUninstall={uninstall}
              />
            ) : (
              <PluginCard
                key={plugin.id}
                {...shared}
                mode="enable"
                enabled={approvals.isEnabledForEntity(plugin.id)}
                onEnable={enable}
                onDisable={disable}
              />
            );
          })}
        </div>
      </>
    );
  };

  const tabs = isSuperAdmin ? [CATALOG_TAB, ORGANIZATION_TAB] : [ORGANIZATION_TAB];
  const tab = params.get("tab");
  // The catalog is the superuser's: anyone else lands on the installed plugins.
  if (!checkingRole && tab && !tabs.some(({ id }) => id === tab)) {
    return <Navigate to="/admin/plugins" replace />;
  }

  return (
    <SettingsLayout
      title="Plugins"
      description={
        isSuperAdmin
          ? "BrightQuery plugins served by the configured plugin host. Install a plugin to make it available to administrators, who enable it for their organization."
          : "Plugins installed for Workspace. Enabled plugins are available to your organization's users and dashboards."
      }
      tabs={checkingRole ? [] : tabs}
      defaultTab={tabs[0].id}
    >
      {checkingRole ? (
        <div className="p-6">
          <LoadingCards />
        </div>
      ) : (
        <>
          {isSuperAdmin && (
            <TabsPrimitive.Content
              value={CATALOG_TAB.id}
              className="p-6 flex flex-col gap-4"
            >
              {renderTab("install")}
            </TabsPrimitive.Content>
          )}
          <TabsPrimitive.Content
            value={ORGANIZATION_TAB.id}
            className="p-6 flex flex-col gap-4"
          >
            {renderTab("enable")}
          </TabsPrimitive.Content>
        </>
      )}
    </SettingsLayout>
  );
}
