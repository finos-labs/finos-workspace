import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { type PlatformPlugin, putPluginOverrides } from "~/api/plugins.api";
import { Button } from "~/components/ds/atoms/Button";
import { Checkbox } from "~/components/ds/atoms/Checkbox";
import { Notice } from "~/components/ds/molecules/Notice";
import { pluginKeys } from "~/hooks/usePlugins";
import {
  CONFIRMATIONS,
  type Confirmation,
  checkNetwork,
  checkPolicy,
  POLICY_DIRECTIVES,
} from "~/plugins/csp";
import { errorText, Section } from "./common";

const CONFIRMATION_TEXT: Record<Confirmation, string> = {
  "insecure-scheme": "Allow plain http:// or ws:// (the data travels unencrypted)",
  "private-host":
    "Allow private hosts (IP addresses, localhost, internal names reach into your network)",
  "remote-script":
    "Allow a remote script host (code that can change after this approval)",
};

const PRIVATE_SERVER_TEXT =
  "Let the server network's hosts resolve to private addresses (the API then calls into your network for this plugin)";

const words = (text: string | undefined) => (text ?? "").split(/\s+/).filter(Boolean);

/**
 * A superuser's overrides of a plugin, replaced whole on save: its frame policy per
 * directive (SECURITY.md 4) and the hosts the API may call for its proxies (SERVER-SIDE.md
 * 6), each wider or narrower than the author declared. The same rules as the server check
 * them as they are typed; the server checks them again.
 */
export function OverrideEditor(props: {
  plugin: PlatformPlugin;
  declared: Record<string, string[]>;
  declaredNetwork: string[];
  prefill?: { directive: string; source: string } | null;
}) {
  const { plugin, declared, declaredNetwork, prefill } = props;
  const queryClient = useQueryClient();
  const current = plugin.overrides?.csp ?? {};
  const currentNetwork = plugin.overrides?.server_network;
  const [text, setText] = useState<Record<string, string>>({});
  const [overridden, setOverridden] = useState<Set<string>>(new Set());
  const [networkText, setNetworkText] = useState("");
  const [networkOverridden, setNetworkOverridden] = useState(false);
  const [confirmations, setConfirmations] = useState<Set<Confirmation>>(new Set());

  useEffect(() => {
    setText(
      Object.fromEntries(
        POLICY_DIRECTIVES.map((d) => [d, (current[d] ?? declared[d] ?? []).join(" ")]),
      ),
    );
    setOverridden(new Set(Object.keys(current)));
    setNetworkText((currentNetwork ?? declaredNetwork).join(" "));
    setNetworkOverridden(currentNetwork !== undefined);
    setConfirmations(
      new Set((plugin.overrides?.confirmations ?? []) as Confirmation[]),
    );
  }, [plugin.overrides, declared, declaredNetwork]);

  useEffect(() => {
    if (!prefill) return;
    setOverridden((prev) => new Set(prev).add(prefill.directive));
    setText((prev) => {
      const sources = words(prev[prefill.directive]);
      if (!sources.includes(prefill.source)) sources.push(prefill.source);
      return { ...prev, [prefill.directive]: sources.join(" ") };
    });
  }, [prefill]);

  const policy = useMemo(
    () => Object.fromEntries([...overridden].map((d) => [d, words(text[d])])),
    [overridden, text],
  );
  const network = useMemo(
    () => (networkOverridden ? words(networkText) : null),
    [networkOverridden, networkText],
  );
  // tcp:// endpoints are for a backend, which a version of the plugin declares
  const backend = plugin.versions.some((v) => v.server.backend);
  const check = useMemo(() => {
    const csp = checkPolicy(policy, { confirmations, override: true });
    const server = network
      ? checkNetwork(network, { confirmations, override: true, backend })
      : { errors: [] };
    return [...csp.errors, ...server.errors];
  }, [policy, network, confirmations, backend]);
  const needed = useMemo(() => {
    const found = new Set(checkPolicy(policy).needs);
    for (const need of network ? checkNetwork(network, { backend }).needs : [])
      found.add(need);
    return found;
  }, [policy, network, backend]);
  const kept = [...confirmations].filter(
    (c) => needed.has(c) || (c === "private-host" && network !== null),
  );

  const { mutate: save, isPending } = useMutation({
    mutationFn: () =>
      putPluginOverrides(plugin.plugin_id, {
        csp: Object.keys(policy).length ? policy : null,
        server_network: network,
        confirmations: kept,
      }),
    onSuccess: () => {
      toast.success("Overrides saved");
      queryClient.invalidateQueries({ queryKey: pluginKeys.platform });
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const toggle = (confirmation: Confirmation, on: boolean) => {
    const next = new Set(confirmations);
    if (on) next.add(confirmation);
    else next.delete(confirmation);
    setConfirmations(next);
  };

  return (
    <Section
      title="Overrides"
      hint="Tick a directive to override the author's list for it. An empty list closes it. Sources and hosts are separated by spaces."
    >
      <div className="flex flex-col gap-2">
        {POLICY_DIRECTIVES.map((directive) => (
          <div
            key={directive}
            className="grid grid-cols-[160px_1fr] items-center gap-2"
          >
            <Checkbox
              label={directive}
              checked={overridden.has(directive)}
              onCheckedChange={(on) => {
                const next = new Set(overridden);
                if (on === true) next.add(directive);
                else next.delete(directive);
                setOverridden(next);
              }}
            />
            <input
              aria-label={`${directive} sources`}
              className="rounded border border-general-border-secondary bg-transparent px-2 py-1 font-mono body-xs-regular"
              value={text[directive] ?? ""}
              disabled={!overridden.has(directive)}
              placeholder={
                (declared[directive] ?? []).join(" ") || "(nothing declared)"
              }
              onChange={(e) => setText({ ...text, [directive]: e.target.value })}
            />
          </div>
        ))}
        <div className="grid grid-cols-[160px_1fr] items-center gap-2">
          <Checkbox
            label="server network"
            checked={networkOverridden}
            onCheckedChange={(on) => setNetworkOverridden(on === true)}
          />
          <input
            aria-label="server network hosts"
            className="rounded border border-general-border-secondary bg-transparent px-2 py-1 font-mono body-xs-regular"
            value={networkText}
            disabled={!networkOverridden}
            placeholder={declaredNetwork.join(" ") || "(nothing declared)"}
            onChange={(e) => setNetworkText(e.target.value)}
          />
        </div>
      </div>
      {[...needed].map((confirmation) => (
        <Checkbox
          key={confirmation}
          label={CONFIRMATION_TEXT[confirmation as Confirmation]}
          checked={confirmations.has(confirmation as Confirmation)}
          onCheckedChange={(on) => toggle(confirmation as Confirmation, on === true)}
        />
      ))}
      {network !== null && !needed.has("private-host") && (
        <Checkbox
          label={PRIVATE_SERVER_TEXT}
          checked={confirmations.has("private-host")}
          onCheckedChange={(on) => toggle("private-host", on === true)}
        />
      )}
      {!check.length || (
        <Notice variant="error" title="The overrides are not valid">
          {check.join("; ")}
        </Notice>
      )}
      <div>
        <Button
          variant="primary"
          size="sm"
          disabled={!!check.length || isPending}
          onClick={() => save()}
        >
          Save overrides
        </Button>
      </div>
      <span className="body-xs-regular text-ds-text-caption">
        Known confirmations: {CONFIRMATIONS.join(", ")}. Every change is recorded.
      </span>
    </Section>
  );
}
