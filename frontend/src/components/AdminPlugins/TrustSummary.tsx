import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Fragment, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  approvePluginVersion,
  type PlatformPlugin,
  type PlatformVersion,
  type ReviewItem,
} from "~/api/plugins.api";
import { Button } from "~/components/ds/atoms/Button";
import { Checkbox } from "~/components/ds/atoms/Checkbox";
import { Notice } from "~/components/ds/molecules/Notice";
import { errorText, formatBytes, RiskTag, Section, shortDigest } from "./common";

const FAMILY_TITLES: Record<ReviewItem["family"], string> = {
  widgets: "Widgets",
  permissions: "Host permissions",
  network: "Network (the frame's policy and the server's hosts)",
  proxies: "Server calls (proxies)",
  secrets: "Secrets",
  backend: "Server-side code (backend)",
  data: "The user's data and identity",
  code: "Code",
};

export function TrustSummary(props: {
  plugin: PlatformPlugin;
  version: PlatformVersion;
}) {
  const { plugin, version } = props;
  const queryClient = useQueryClient();
  const manifest = version.manifest;
  const review = version.review ?? [];
  const added = review.filter((item) => item.added);
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set());
  const [responsible, setResponsible] = useState(false);

  const byFamily = useMemo(() => {
    const groups = new Map<ReviewItem["family"], ReviewItem[]>();
    for (const item of review)
      groups.set(item.family, [...(groups.get(item.family) ?? []), item]);
    return groups;
  }, [review]);

  const { mutate: approve, isPending } = useMutation({
    mutationFn: () =>
      approvePluginVersion(plugin.plugin_id, version.version, {
        digest: version.digest ?? "",
        acknowledged: [...acknowledged],
      }),
    onSuccess: () => {
      toast.success(`${plugin.name} ${version.version} approved`);
      queryClient.invalidateQueries({ queryKey: ["widget-plugins"] });
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const allAcknowledged = added.every((item) => acknowledged.has(item.key));
  const isUpdate = !!plugin.active_version && plugin.active_version !== version.version;

  return (
    <div
      className="flex flex-col gap-4"
      data-testid={`trust-summary-${version.version}`}
    >
      <Section title="What it is">
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 body-xs-regular">
          <dt className="text-ds-text-caption">Name</dt>
          <dd>{manifest.name ?? plugin.plugin_id}</dd>
          <dt className="text-ds-text-caption">Id and version</dt>
          <dd>
            {plugin.plugin_id} {version.version}
          </dd>
          <dt className="text-ds-text-caption">Publisher</dt>
          <dd>
            {manifest.publisher?.name ?? "-"}{" "}
            <span className="text-ds-text-caption">
              (as the package states it; not verified)
            </span>
          </dd>
          <dt className="text-ds-text-caption">Description</dt>
          <dd>{manifest.description || "-"}</dd>
        </dl>
      </Section>

      <Section title="Integrity">
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 body-xs-regular">
          <dt className="text-ds-text-caption">Version digest</dt>
          <dd className="break-all font-mono">{version.digest}</dd>
          <dt className="text-ds-text-caption">Checksum</dt>
          <dd>
            {version.checksum === version.declared_checksum
              ? "matches the manifest"
              : "does not match the manifest: write the current checksum before approving"}
          </dd>
          <dt className="text-ds-text-caption">Pin</dt>
          <dd>
            {version.pin_status === "pinned"
              ? "pinned by the deployer"
              : "not pinned (set WIDGET_PLUGINS_PINS to pin it)"}
          </dd>
          <dt className="text-ds-text-caption">Files served to browsers</dt>
          <dd>
            {Object.entries(version.files)
              .map(([path, info]) => `${path} (${formatBytes(info.size)})`)
              .join(", ")}
          </dd>
        </dl>
        {version.findings.warnings.map((warning) => (
          <Notice key={warning} variant="warning" title="Warning">
            {warning}
          </Notice>
        ))}
      </Section>

      <Section title="Network of the frame">
        {version.csp.egress.length ? (
          <Notice variant="warning" title="Egress">
            This plugin can send the data it displays to:{" "}
            {version.csp.egress.join(", ")}
          </Notice>
        ) : (
          <p className="body-xs-regular">
            No network access: the frame cannot reach any host.
          </p>
        )}
      </Section>

      <Section title="Server side">
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 body-xs-regular">
          <dt className="text-ds-text-caption">Runs code on the server</dt>
          <dd>
            {version.server.backend
              ? "Yes, in a separate process the deployer runs and isolates"
              : `No${version.server.proxies.length ? ": the server fills the request templates below and sends them" : ""}`}
          </dd>
          <dt className="text-ds-text-caption">Hosts the server may call</dt>
          <dd>
            {version.server.network.approved.join(", ") || "none"}
            {plugin.overrides?.server_network && " (your override)"}
            {version.server.private && ", which may resolve to private addresses"}
          </dd>
          {version.server.proxies.map((proxy) => (
            <Fragment key={proxy.id}>
              <dt className="text-ds-text-caption">Proxy {proxy.id}</dt>
              <dd className="break-all font-mono">
                {proxy.method ?? "GET"} {proxy.url}
              </dd>
            </Fragment>
          ))}
          {version.server.backend?.routes.map((route) => (
            <Fragment key={route.id}>
              <dt className="text-ds-text-caption">Route {route.id}</dt>
              <dd>
                {route.secrets?.length
                  ? `sends the secrets ${route.secrets.join(", ")}`
                  : "sends no secret"}
              </dd>
            </Fragment>
          ))}
          {version.server.data_sources.map((source) => (
            <Fragment key={source.id}>
              <dt className="text-ds-text-caption">Data source {source.id}</dt>
              <dd>
                {source.purpose}{" "}
                <span className="text-ds-text-caption">
                  (read for the user, with the user's access, through the broker)
                </span>
              </dd>
            </Fragment>
          ))}
          {version.server.backend && (
            <>
              <dt className="text-ds-text-caption">What it learns of the user</dt>
              <dd>
                {version.server.identity === "pseudonymous"
                  ? "An anonymous id, the same in every call of this plugin"
                  : "Nothing"}
              </dd>
            </>
          )}
          {version.server.secrets.map((secret) => (
            <Fragment key={secret.name}>
              <dt className="text-ds-text-caption">Secret {secret.name}</dt>
              <dd>
                {secret.purpose}{" "}
                <span className="text-ds-text-caption">
                  (the value is never shown, and the plugin's code never sees it)
                </span>
              </dd>
            </Fragment>
          ))}
        </dl>
      </Section>

      <Section
        title={isUpdate ? `Changes since ${plugin.active_version}` : "What it asks for"}
        hint="Acknowledge each request the active version does not already make."
      >
        {[...byFamily.entries()].map(([family, items]) => (
          <div key={family} className="flex flex-col gap-1">
            <span className="body-xs-medium text-ds-text-caption">
              {FAMILY_TITLES[family]}
            </span>
            {items.map((item) =>
              item.removed ? (
                <span
                  key={`removed-${item.key}`}
                  className="body-xs-regular line-through text-ds-text-caption"
                >
                  {item.label} (removed)
                </span>
              ) : item.added ? (
                <div key={item.key} className="flex items-center gap-2">
                  <Checkbox
                    label={`${item.label}${item.overridden ? " (your override)" : ""}`}
                    checked={acknowledged.has(item.key)}
                    onCheckedChange={(on) => {
                      const next = new Set(acknowledged);
                      if (on === true) next.add(item.key);
                      else next.delete(item.key);
                      setAcknowledged(next);
                    }}
                  />
                  <RiskTag risk={item.risk} />
                </div>
              ) : (
                <span key={item.key} className="body-xs-regular text-ds-text-caption">
                  {item.label} (unchanged)
                </span>
              ),
            )}
          </div>
        ))}
        {version.csp.notes && Object.keys(version.csp.notes).length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="body-xs-medium text-ds-text-caption">
              The author's reasons
            </span>
            {Object.entries(version.csp.notes).map(([directive, note]) => (
              <span key={directive} className="body-xs-regular">
                {directive}: {note}
              </span>
            ))}
          </div>
        )}
      </Section>

      <div className="flex flex-col gap-2 border-t border-general-border-secondary pt-3">
        <Checkbox
          label={`I have reviewed ${plugin.plugin_id} ${version.version} and take responsibility for trusting it on this FINOS Workspace. Approving it does not make it available to anyone until an organization enables it.`}
          checked={responsible}
          onCheckedChange={(on) => setResponsible(on === true)}
        />
        <div>
          <Button
            variant="primary"
            size="sm"
            disabled={!(responsible && allAcknowledged) || isPending}
            onClick={() => approve()}
          >
            {isUpdate
              ? `Approve ${version.version} and replace ${plugin.active_version}`
              : `Approve ${version.version}`}
          </Button>
        </div>
        <span className="body-xs-regular text-ds-text-caption">
          Approves the digest {shortDigest(version.digest)} only. Any other files are
          refused.
        </span>
      </div>
    </div>
  );
}
