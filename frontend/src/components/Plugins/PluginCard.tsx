/**
 * Card for one plugin on the Admin Portal Plugins page: name, description, version,
 * category, registry status and global Enabled/Disabled state, with "Enable"/"Disable"
 * and "Open" actions. Presentational only.
 */
import { Button } from "~/components/ds/atoms/Button";
import { Tag } from "~/components/ds/atoms/Tag";
import type { PluginMetadata } from "~/lib/plugins";

const STATUS_TAG = {
  active: null,
  inactive: { color: "grey", label: "Inactive" },
  deprecated: { color: "warning", label: "Deprecated" },
} as const;

interface PluginCardProps {
  plugin: PluginMetadata;
  /** Enabled for all users and dashboards. */
  enabled: boolean;
  /** The enabled state is being changed. */
  updating?: boolean;
  onOpen: (plugin: PluginMetadata) => void;
  onToggleEnabled: (plugin: PluginMetadata, enabled: boolean) => void;
}

export function PluginCard({
  plugin,
  enabled,
  updating = false,
  onOpen,
  onToggleEnabled,
}: PluginCardProps) {
  const status = STATUS_TAG[plugin.status];
  const active = plugin.status === "active";

  return (
    <article
      aria-label={plugin.name}
      className="bg-general-bg-primary border border-general-border-secondary hover:border-general-border-primary rounded p-3 flex flex-col gap-3 transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="body-sm-medium text-ds-text-heading">{plugin.name}</h2>
        <div className="flex gap-1">
          {status && <Tag color={status.color}>{status.label}</Tag>}
          <Tag color={enabled ? "success" : "grey"}>
            {enabled ? "Enabled" : "Disabled"}
          </Tag>
        </div>
      </div>
      <p className="text-xs text-ds-text-body line-clamp-3 flex-1">
        {plugin.description}
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-2xs text-ds-text-caption">
        <dt>Version</dt>
        <dd className="text-ds-text-body">{plugin.version}</dd>
        <dt>Category</dt>
        <dd className="text-ds-text-body">{plugin.category}</dd>
      </dl>
      <div className="flex justify-end gap-2">
        {/* An enabled plugin can always be disabled; only active plugins can be enabled. */}
        <Button
          variant="outlined"
          size="xs"
          loading={updating}
          disabled={updating || (!enabled && !active)}
          onClick={() => onToggleEnabled(plugin, !enabled)}
        >
          {enabled ? "Disable" : "Enable"}
        </Button>
        <Button
          variant="secondary"
          size="xs"
          disabled={!active || !enabled}
          onClick={() => onOpen(plugin)}
        >
          Open Plugin
        </Button>
      </div>
    </article>
  );
}
