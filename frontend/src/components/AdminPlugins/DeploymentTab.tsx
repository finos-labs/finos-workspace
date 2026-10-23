import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  forgetPlugin,
  getPlatformPlugins,
  type PlatformPlugin,
  rescanPlugins,
  setPluginRevoked,
} from "~/api/plugins.api";
import { Button } from "~/components/ds/atoms/Button";
import { Tag } from "~/components/ds/atoms/Tag";
import { Notice } from "~/components/ds/molecules/Notice";
import { pluginKeys } from "~/hooks/usePlugins";
import { RenderNoData } from "~/routes/admin";
import { errorText, Section, StateTag, shortDigest } from "./common";
import { OverrideEditor } from "./OverrideEditor";
import { BlockedRequests, PluginEvents } from "./PluginActivity";
import { PluginBackend } from "./PluginBackend";
import { PluginEntities } from "./PluginEntities";
import { PluginSecrets } from "./PluginSecrets";
import { TrustSummary } from "./TrustSummary";

function AsksFor({ plugin }: { plugin: PlatformPlugin }) {
  const version =
    plugin.versions.find((v) => v.version === plugin.active_version) ??
    plugin.versions[0];
  if (!version) return null;
  const markers = [
    version.csp.egress.length > 0 && "frame network",
    version.server.network.approved.length > 0 && "server network",
    version.server.secrets.length > 0 && "secrets",
    version.server.data_sources.length > 0 && "data sources",
    !!version.server.backend && "server-side code",
  ].filter((marker): marker is string => !!marker);
  return (
    <span className="flex flex-wrap gap-1">
      {markers.length
        ? markers.map((marker) => (
            <Tag key={marker} color="grey">
              {marker}
            </Tag>
          ))
        : "-"}
    </span>
  );
}

export function DeploymentTab() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: pluginKeys.platform,
    queryFn: getPlatformPlugins,
  });
  const [selected, setSelected] = useState<string | null>(null);

  const { mutate: rescan, isPending: scanning } = useMutation({
    mutationFn: rescanPlugins,
    onSuccess: (summary) => {
      const parts = [
        summary.discovered.length && `${summary.discovered.length} discovered`,
        summary.blocked.length && `${summary.blocked.length} blocked`,
        summary.missing.length && `${summary.missing.length} missing`,
        summary.restored.length && `${summary.restored.length} back`,
        summary.rejected.length && `${summary.rejected.length} paths not read`,
      ].filter(Boolean);
      toast.success(
        parts.length ? `Rescanned: ${parts.join(", ")}` : "Rescanned: no changes",
      );
      queryClient.invalidateQueries({ queryKey: ["widget-plugins"] });
    },
    onError: (error) => toast.error(errorText(error)),
  });

  if (isLoading || isError || !data)
    return (
      <RenderNoData isLoading={isLoading} isError={isError || !data} children={null} />
    );

  if (!data.enabled)
    return (
      <Notice variant="info" title="Widget plugins are off">
        The API has no plugins directory. A deployer turns the feature on by setting
        WIDGET_PLUGINS_DIR and placing packages there; nothing can be installed from
        here.
      </Notice>
    );

  const plugin = data.plugins.find((p) => p.plugin_id === selected) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="body-xs-regular text-ds-text-caption">
          Packages the deployer placed in the plugins directory. A new plugin or version
          does nothing until you approve it, and an approved plugin is available to
          nobody until an organization enables it.
        </p>
        <Button
          size="sm"
          variant="secondary"
          disabled={scanning}
          onClick={() => rescan()}
        >
          Rescan
        </Button>
      </div>

      {data.plugins.length === 0 ? (
        <p className="body-xs-regular">
          No plugins found. Rescan after placing a package.
        </p>
      ) : (
        <table className="w-full body-xs-regular" data-testid="platform-plugins">
          <thead className="text-left text-ds-text-caption">
            <tr>
              <th className="py-1">Plugin</th>
              <th>Status</th>
              <th>Active</th>
              <th>Versions</th>
              <th>Asks for</th>
              <th>Organizations</th>
            </tr>
          </thead>
          <tbody>
            {data.plugins.map((p) => (
              <tr
                key={p.plugin_id}
                className={`cursor-pointer border-t border-general-border-secondary ${selected === p.plugin_id ? "bg-general-bg-secondary" : ""}`}
                onClick={() =>
                  setSelected(p.plugin_id === selected ? null : p.plugin_id)
                }
              >
                <td className="py-1.5">
                  <span className="body-xs-medium">{p.name}</span>{" "}
                  <span className="text-ds-text-caption">{p.plugin_id}</span>
                </td>
                <td>
                  <StateTag state={p.status} />
                </td>
                <td>
                  {p.active_version ?? "-"}
                  {p.update_available && (
                    <span className="ml-1 text-ds-text-caption">
                      (update {p.update_available})
                    </span>
                  )}
                </td>
                <td className="flex flex-wrap gap-1 py-1.5">
                  {p.versions.map((v) => (
                    <span key={v.version} className="flex items-center gap-1">
                      {v.version} <StateTag state={v.state} />
                    </span>
                  ))}
                </td>
                <td>
                  <AsksFor plugin={p} />
                </td>
                <td>{p.enabled_entities}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {plugin && <PluginDetail plugin={plugin} />}
    </div>
  );
}

function PluginDetail({ plugin }: { plugin: PlatformPlugin }) {
  const queryClient = useQueryClient();
  const [prefill, setPrefill] = useState<{ directive: string; source: string } | null>(
    null,
  );
  const active = plugin.versions.find((v) => v.version === plugin.active_version);
  const reviewable = plugin.versions.filter(
    (v) => v.state === "discovered" || v.state === "retired",
  );

  const { mutate: setRevoked } = useMutation({
    mutationFn: (revoked: boolean) => setPluginRevoked(plugin.plugin_id, revoked),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["widget-plugins"] }),
    onError: (error) => toast.error(errorText(error)),
  });
  const { mutate: forget } = useMutation({
    mutationFn: () => forgetPlugin(plugin.plugin_id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["widget-plugins"] }),
    onError: (error) => toast.error(errorText(error)),
  });
  const allMissing = plugin.versions.every((v) => v.state === "missing");

  return (
    <div
      className="flex flex-col gap-5 rounded border border-general-border-secondary p-4"
      data-testid={`plugin-detail-${plugin.plugin_id}`}
    >
      <div className="flex items-center gap-2">
        <h2 className="body-md-bold">{plugin.name}</h2>
        <StateTag state={plugin.status} />
        <div className="ml-auto flex gap-2">
          {plugin.status === "revoked" ? (
            <Button size="sm" variant="secondary" onClick={() => setRevoked(false)}>
              Restore
            </Button>
          ) : (
            plugin.active_version && (
              <Button size="sm" variant="danger" onClick={() => setRevoked(true)}>
                Revoke
              </Button>
            )
          )}
          {allMissing && (
            <Button size="sm" variant="secondary" onClick={() => forget()}>
              Forget
            </Button>
          )}
        </div>
      </div>

      <Section title="Versions">
        <ul className="flex flex-col gap-1 body-xs-regular">
          {plugin.versions.map((v) => (
            <li key={v.version} className="flex flex-wrap items-center gap-2">
              <span className="body-xs-medium">{v.version}</span>
              <StateTag state={v.state} />
              <span className="font-mono text-ds-text-caption">
                {shortDigest(v.digest)}
              </span>
              <span className="text-ds-text-caption">{v.pin_status}</span>
              {v.blocked_reason && (
                <span className="text-red-500">{v.blocked_reason}</span>
              )}
            </li>
          ))}
        </ul>
      </Section>

      {reviewable.map((version) => (
        <div key={version.version} className="flex flex-col gap-2">
          <h3 className="body-sm-bold">
            Review {version.version}
            {version.state === "retired" && " (an earlier version)"}
          </h3>
          <TrustSummary plugin={plugin} version={version} />
        </div>
      ))}

      {active && plugin.status !== "revoked" && (
        <PluginEntities pluginId={plugin.plugin_id} />
      )}

      <PluginSecrets plugin={plugin} />
      <PluginBackend plugin={plugin} />

      {active && (
        <OverrideEditor
          plugin={plugin}
          declared={active.csp.declared}
          declaredNetwork={active.server.network.declared}
          prefill={prefill}
        />
      )}
      <BlockedRequests
        pluginId={plugin.plugin_id}
        scope="platform"
        onAllow={(directive, origin) => setPrefill({ directive, source: origin })}
      />
      <PluginEvents pluginId={plugin.plugin_id} scope="platform" />
    </div>
  );
}
