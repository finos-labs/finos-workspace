import React, { useEffect, useState } from "react";
import { BaseDialog, DialogTitle } from "ui/Dialog";
import {
  type AddResponse,
  type PluginDetail,
  type PluginSummary,
  type PluginVersion,
  type User,
  approvePluginVersion,
  getPlugin,
  getPlugins,
  rescanPlugins,
  setPluginEntity,
  setPluginRevoked,
} from "utils/requests";

type AccessMode = "everyone" | "roles";

/**
 * Widget plugins for the operator (docs/widget-plugins/DESIGN.md 8.6): rescan, review
 * and approve, enable per entity, revoke. Unlike the other managers there is no "Add":
 * a deployer places packages in the API's plugins directory; nothing installs from here.
 */
export function PluginManager({ user }: { user: User }): JSX.Element {
  const [listing, setListing] = useState<{
    enabled: boolean;
    plugins: PluginSummary[];
  } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const load = async (): Promise<void> => {
    setListing(await getPlugins(user.accessToken));
  };

  useEffect(() => {
    load().catch(console.error);
  }, []);

  const rescan = async (): Promise<void> => {
    const response = await rescanPlugins(user.accessToken);
    setMessage(response.success ? "Rescanned" : (response.message ?? "Rescan failed"));
    await load();
  };

  if (listing === null) {
    return <div className="ws-card p-5 text-xs">Plugins could not be loaded.</div>;
  }

  return (
    <div className="ws-card overflow-hidden">
      {selected !== null && (
        <BaseDialog open onClose={() => setSelected(null)}>
          <PluginDetailView
            pluginId={selected}
            user={user}
            onChanged={() => {
              load().catch(console.error);
            }}
          />
        </BaseDialog>
      )}
      <div className="ws-card-header flex items-center justify-between gap-2">
        <p className="text-xs text-ds-text-subtitle">
          {listing.enabled
            ? "Packages the deployer placed in the plugins directory. Nothing runs until a version is approved and an entity enables the plugin."
            : "Widget plugins are off: the API has no WIDGET_PLUGINS_DIR."}
        </p>
        {listing.enabled && (
          <button type="button" className="ws-btn-blue" onClick={() => rescan()}>
            Rescan
          </button>
        )}
      </div>
      {message && <p className="px-5 pt-2 text-xs text-ds-text-subtitle">{message}</p>}
      <div className="ws-card-content">
        <table className="w-full overflow-hidden rounded border border-general-border-primary">
          <thead>
            <tr className="border-b border-surface-divider bg-general-bg-secondary">
              {["Plugin", "Status", "Active", "Versions", "Entities"].map((header) => (
                <th
                  key={header}
                  className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-ds-text-subtitle"
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {listing.plugins.map((p) => (
              <tr
                key={p.plugin_id}
                className="cursor-pointer border-b border-surface-divider bg-general-bg-primary hover:bg-general-bg-primary-hover"
                onClick={() => setSelected(p.plugin_id)}
              >
                <td className="px-5 py-3 text-xs text-ds-text-body">
                  {p.name} <span className="text-ds-text-subtitle">{p.plugin_id}</span>
                </td>
                <td className="px-5 py-3 text-xs">{p.status}</td>
                <td className="px-5 py-3 text-xs">
                  {p.active_version ?? "-"}
                  {p.update_available && ` (update ${p.update_available})`}
                </td>
                <td className="px-5 py-3 text-xs">
                  {p.versions.map((v) => `${v.version} ${v.state}`).join(", ")}
                </td>
                <td className="px-5 py-3 text-xs">{p.enabled_entities}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {listing.plugins.length === 0 && (
          <div className="py-6 text-center text-xs text-ds-text-subtitle">
            No plugins found. Place a package in the plugins directory and rescan.
          </div>
        )}
      </div>
    </div>
  );
}

function PluginDetailView(props: {
  pluginId: string;
  user: User;
  onChanged: () => void;
}): JSX.Element {
  const { pluginId, user, onChanged } = props;
  const [plugin, setPlugin] = useState<PluginDetail | null>(null);
  const [message, setMessage] = useState("");

  const load = async (): Promise<void> => {
    setPlugin(await getPlugin(pluginId, user.accessToken));
  };

  useEffect(() => {
    load().catch(console.error);
  }, [pluginId]);

  const run = async (request: Promise<AddResponse>, done: string): Promise<void> => {
    const response = await request;
    setMessage(response.success ? done : (response.message ?? "The request failed"));
    await load();
    onChanged();
  };

  if (plugin === null) return <DialogTitle>{pluginId}</DialogTitle>;

  const reviewable = plugin.versions.filter(
    (v) => v.state === "discovered" || v.state === "retired",
  );
  const enabledFor = (entityUuid: string | null, enabled: boolean, mode?: AccessMode) =>
    run(
      setPluginEntity(
        pluginId,
        entityUuid,
        { enabled, ...(mode ? { access_mode: mode } : {}) },
        user.accessToken,
      ),
      enabled ? "Enabled" : "Disabled",
    );

  return (
    <div className="space-y-4 text-xs">
      <DialogTitle>{`${plugin.name} (${plugin.plugin_id}): ${plugin.status}`}</DialogTitle>
      {message && <p className="text-ds-text-subtitle">{message}</p>}

      <ul className="space-y-1">
        {plugin.versions.map((v) => (
          <li key={v.version}>
            {v.version} {v.state}
            {v.blocked_reason && ` (${v.blocked_reason})`} {v.pin_status}{" "}
            <span className="font-mono text-ds-text-subtitle">{v.digest ?? "-"}</span>
          </li>
        ))}
      </ul>

      {reviewable.map((v) => (
        <ApproveVersion
          key={v.version}
          version={v}
          onApprove={(acknowledged) =>
            run(
              approvePluginVersion(
                pluginId,
                v.version,
                v.digest ?? "",
                acknowledged,
                user.accessToken,
              ),
              `${v.version} approved`,
            )
          }
        />
      ))}

      {plugin.active_version !== null && plugin.status !== "revoked" && (
        <div className="space-y-2">
          <p className="font-semibold">Enabled for</p>
          <div className="flex gap-2">
            <button type="button" className="ws-btn" onClick={() => enabledFor(null, true, "roles")}>
              Enable for all (roles)
            </button>
            <button type="button" className="ws-btn" onClick={() => enabledFor(null, false)}>
              Disable for all
            </button>
          </div>
          <table className="w-full">
            <tbody>
              {plugin.entities.map((e) => (
                <tr key={e.entity_uuid} className="border-b border-surface-divider">
                  <td className="py-1.5">{e.name ?? e.entity_uuid}</td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Enabled for ${e.name ?? e.entity_uuid}`}
                      checked={e.enabled}
                      onChange={(event) => enabledFor(e.entity_uuid, event.target.checked)}
                    />
                  </td>
                  <td>
                    <select
                      aria-label={`Who may use it in ${e.name ?? e.entity_uuid}`}
                      className="rounded border border-general-border-primary bg-transparent p-1"
                      value={e.access_mode ?? "roles"}
                      disabled={!e.enabled}
                      onChange={(event) =>
                        enabledFor(e.entity_uuid, true, event.target.value as AccessMode)
                      }
                    >
                      <option value="roles">Roles the entity chooses</option>
                      <option value="everyone">Everyone in the entity</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex justify-end">
        {plugin.status === "revoked" ? (
          <button
            type="button"
            className="ws-btn"
            onClick={() => run(setPluginRevoked(pluginId, false, user.accessToken), "Restored")}
          >
            Restore
          </button>
        ) : (
          plugin.active_version !== null && (
            <button
              type="button"
              className="ws-btn"
              onClick={() => run(setPluginRevoked(pluginId, true, user.accessToken), "Revoked")}
            >
              Revoke everywhere
            </button>
          )
        )}
      </div>
    </div>
  );
}

function ApproveVersion(props: {
  version: PluginVersion;
  onApprove: (acknowledged: string[]) => void;
}): JSX.Element {
  const { version, onApprove } = props;
  const [acknowledged, setAcknowledged] = useState(false);
  const review = version.review ?? [];
  const added = review.filter((item) => item.added).map((item) => item.key);

  return (
    <div className="space-y-2 rounded border border-general-border-primary p-3">
      <p className="font-semibold">Review {version.version}</p>
      <ul className="space-y-0.5">
        {review.map((item) => (
          <li key={item.key}>
            {item.added ? "+ " : item.removed ? "- " : "  "}
            {item.family}: {item.label}
            {item.risk !== "none" && ` (${item.risk} risk)`}
          </li>
        ))}
        {version.findings.warnings.map((warning) => (
          <li key={warning} className="text-ds-text-subtitle">
            ! {warning}
          </li>
        ))}
      </ul>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
        />
        I reviewed the {added.length} added requests and accept them
      </label>
      <button
        type="button"
        className="ws-btn-blue"
        disabled={!acknowledged}
        onClick={() => onApprove(added)}
      >
        Approve {version.version}
      </button>
    </div>
  );
}
