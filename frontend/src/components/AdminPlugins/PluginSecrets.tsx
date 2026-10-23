import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  deletePluginSecret,
  type PlatformPlugin,
  type PluginSecretStatus,
  putPluginSecret,
} from "~/api/plugins.api";
import { Button } from "~/components/ds/atoms/Button";
import { Tag } from "~/components/ds/atoms/Tag";
import { pluginKeys } from "~/hooks/usePlugins";
import { errorText, formatWhen, Section } from "./common";

export function PluginSecrets({ plugin }: { plugin: PlatformPlugin }) {
  if (!plugin.secrets.length) return null;
  return (
    <Section
      title="Secrets"
      hint="The server adds these to the plugin's proxy calls. The plugin's code never sees them, and nothing shows a value once it is set."
    >
      <ul className="flex flex-col gap-3" data-testid="plugin-secrets">
        {plugin.secrets.map((secret) => (
          <SecretRow key={secret.name} pluginId={plugin.plugin_id} secret={secret} />
        ))}
      </ul>
    </Section>
  );
}

function SecretRow(props: { pluginId: string; secret: PluginSecretStatus }) {
  const { pluginId, secret } = props;
  const queryClient = useQueryClient();
  const [value, setValue] = useState("");
  const done = (message: string) => {
    setValue("");
    toast.success(message);
    queryClient.invalidateQueries({ queryKey: pluginKeys.platform });
  };

  const { mutate: save, isPending: saving } = useMutation({
    mutationFn: () => putPluginSecret(pluginId, secret.name, value),
    onSuccess: () => done(`${secret.name} set`),
    onError: (error) => toast.error(errorText(error)),
  });
  const { mutate: clear, isPending: clearing } = useMutation({
    mutationFn: () => deletePluginSecret(pluginId, secret.name),
    onSuccess: () => done(`${secret.name} cleared`),
    onError: (error) => toast.error(errorText(error)),
  });

  const fromConfiguration = secret.source === "configuration";
  return (
    <li
      className="flex flex-col gap-1 body-xs-regular"
      data-testid={`plugin-secret-${secret.name}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="body-xs-medium font-mono">{secret.name}</span>
        {secret.set ? (
          <Tag color={secret.problem ? "danger" : "success"}>set</Tag>
        ) : (
          <Tag color="warning">not set</Tag>
        )}
        <span className="text-ds-text-caption">
          {secret.declared ? secret.purpose : "No version declares it any more."}
        </span>
      </div>
      <span className="text-ds-text-caption">
        {fromConfiguration
          ? "Set by the deployment's configuration; change it there."
          : secret.set
            ? `Set by ${secret.set_by_uuid ?? "-"} on ${formatWhen(secret.set_at)}.`
            : "Calls that need it fail until it is set."}
        {secret.problem && ` ${secret.problem}.`}
      </span>
      {!fromConfiguration && (
        <div className="flex items-center gap-2">
          {secret.declared && (
            <>
              <input
                type="password"
                autoComplete="off"
                aria-label={`New value of ${secret.name}`}
                className="w-72 rounded border border-general-border-secondary bg-transparent px-2 py-1 font-mono body-xs-regular"
                placeholder={secret.set ? "A new value replaces the current one" : ""}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
              <Button
                size="xs"
                variant="primary"
                disabled={!value || saving}
                onClick={() => save()}
              >
                {secret.set ? "Replace" : "Set"}
              </Button>
            </>
          )}
          {secret.set && (
            <Button
              size="xs"
              variant="secondary"
              disabled={clearing}
              onClick={() => clear()}
            >
              Clear
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
