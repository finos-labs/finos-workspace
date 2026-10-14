/**
 * Route /app/plugins/:pluginId. Shows one plugin full page: checks it through the
 * Plugin Manager, then loads the plugin host page in a sandboxed iframe, with loading
 * and error states and an "Add to dashboard" action.
 */
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "~/components/ds/atoms/Button";
import { Notice } from "~/components/ds/molecules/Notice";
import Icon from "~/components/Icon";
import { AddPluginToDashboardDialog } from "~/components/Plugins/AddPluginToDashboardDialog";
import { usePluginManager } from "~/hooks/usePluginManager";
import { IFRAME_SANDBOX_ATTRIBUTES } from "~/lib/constants";
import { useShallowThemeStore } from "~/lib/state/theme";

/** Full-page plugin runtime: the plugin host page for one plugin, in a sandboxed iframe. */
export default function PluginRuntimePage() {
  const { pluginId = "" } = useParams<{ pluginId: string }>();
  const manager = usePluginManager();
  const theme = useShallowThemeStore((state) => state.theme);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [adding, setAdding] = useState(false);

  const { data, error, isLoading } = useQuery({
    queryKey: [
      "plugin-runtime",
      manager.host.ok ? manager.host.baseUrl : null,
      pluginId,
      theme,
    ],
    queryFn: async () => {
      const plugin = await manager.getPlugin(pluginId);
      const availability = await manager.checkAvailability(pluginId, { theme });
      return { plugin, availability };
    },
    enabled: manager.host.ok,
    retry: false,
    refetchOnWindowFocus: false,
  });

  let body: ReactNode;
  if (manager.host.ok === false) {
    body = (
      <Notice variant="warning" title="Plugins are not configured">
        {manager.host.message}
      </Notice>
    );
  } else if (isLoading) {
    body = (
      <p role="status" className="body-xs-regular text-ds-text-caption">
        Loading plugin…
      </p>
    );
  } else if (error) {
    body = (
      <Notice variant="error" title="Could not load the plugin">
        {error.message}
      </Notice>
    );
  } else if (data && data.availability.ok === false) {
    body = (
      <Notice variant="warning" title="This plugin can't be opened">
        {data.availability.message}
      </Notice>
    );
  } else if (data?.availability.ok && data.plugin) {
    body = (
      <div className="relative flex-1 min-h-0 rounded border border-general-border-secondary overflow-hidden">
        {!frameLoaded && (
          <p
            role="status"
            className="absolute inset-0 flex items-center justify-center body-xs-regular text-ds-text-caption"
          >
            Starting {data.plugin.name}…
          </p>
        )}
        <iframe
          key={data.availability.url}
          title={data.plugin.name}
          src={data.availability.url}
          sandbox={IFRAME_SANDBOX_ATTRIBUTES}
          referrerPolicy="strict-origin-when-cross-origin"
          className="w-full h-full border-0"
          onLoad={() => setFrameLoaded(true)}
        />
      </div>
    );
  }

  const plugin = data?.plugin;
  const ready = data?.availability.ok && plugin;

  return (
    <div className="flex flex-col h-full gap-3 p-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Link
            to="/app/plugins"
            className="flex items-center gap-1 body-xs-regular text-ds-text-caption hover:text-ds-text-heading"
          >
            <Icon id="chevron-left" className="size-4" />
            Plugins
          </Link>
          {data?.plugin && (
            <h1 className="body-sm-medium text-ds-text-heading truncate">
              {data.plugin.name}
              <span className="ml-2 text-2xs text-ds-text-caption">
                v{data.plugin.version}
              </span>
            </h1>
          )}
        </div>
        {ready && (
          <Button variant="secondary" size="xs" onClick={() => setAdding(true)}>
            Add to dashboard
          </Button>
        )}
      </div>
      {body}
      {adding && plugin && data?.availability.ok && (
        <AddPluginToDashboardDialog
          plugin={plugin}
          resolveUrl={(settings) =>
            manager.resolvePluginUrl(plugin, { theme, settings })
          }
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}
