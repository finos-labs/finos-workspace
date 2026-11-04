import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { checkPluginBackend, type PlatformPlugin } from "~/api/plugins.api";
import { Button } from "~/components/ds/atoms/Button";
import { Tag } from "~/components/ds/atoms/Tag";
import { Notice } from "~/components/ds/molecules/Notice";
import { pluginKeys } from "~/hooks/usePlugins";
import { errorText, formatWhen, Section } from "./common";

const IDENTITY_TEXT = {
  ok: "Runs the approved version.",
  mismatch: "Runs another version: no call is routed to it.",
  unreachable: "Did not answer: no call is routed to it.",
  unregistered: "Not listed in WIDGET_PLUGIN_BACKENDS.",
} as const;

export function PluginBackend({ plugin }: { plugin: PlatformPlugin }) {
  const queryClient = useQueryClient();
  const active = plugin.versions.find((v) => v.version === plugin.active_version);
  const { mutate: check, isPending } = useMutation({
    mutationFn: () => checkPluginBackend(plugin.plugin_id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: pluginKeys.platform }),
    onError: (error) => toast.error(errorText(error)),
  });
  if (!active?.server.backend) return null;

  const { registered, identity, breaker } = plugin.backend;
  return (
    <Section
      title="Backend"
      hint="Code from the package that the deployer runs as its own restricted process. The API calls it only while it is the approved version."
    >
      <dl
        className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 body-xs-regular"
        data-testid="plugin-backend"
      >
        <dt className="text-ds-text-caption">Registered</dt>
        <dd>
          {registered ? "yes" : "no: the deployer lists it in WIDGET_PLUGIN_BACKENDS"}
        </dd>
        <dt className="text-ds-text-caption">Identity</dt>
        <dd className="flex flex-wrap items-center gap-2">
          {identity ? (
            <>
              <Tag color={identity.state === "ok" ? "success" : "danger"}>
                {identity.state}
              </Tag>
              {IDENTITY_TEXT[identity.state]}{" "}
              {identity.detail && `(${identity.detail})`}
              <span className="text-ds-text-caption">
                checked {formatWhen(new Date(identity.checked_at * 1000).toISOString())}
              </span>
            </>
          ) : (
            "not checked yet"
          )}
        </dd>
        <dt className="text-ds-text-caption">Calls</dt>
        <dd>
          {breaker === "open"
            ? "paused after repeated failures; they resume shortly"
            : "routed"}
        </dd>
      </dl>
      {identity?.state === "mismatch" && (
        <Notice variant="error" title="Another version">
          The backend reports {identity.digest ?? "no digest"}. Rebuild its image from
          the approved version's backend/ directory.
        </Notice>
      )}
      <div>
        <Button
          size="xs"
          variant="secondary"
          disabled={!registered || isPending}
          onClick={() => check()}
        >
          Check now
        </Button>
      </div>
    </Section>
  );
}
