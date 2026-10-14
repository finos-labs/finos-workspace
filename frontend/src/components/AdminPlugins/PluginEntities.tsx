import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  getPlatformPlugin,
  type PluginEntityUse,
  putPluginEntity,
} from "~/api/plugins.api";
import { Button } from "~/components/ds/atoms/Button";
import { Switch } from "~/components/ds/atoms/Switch";
import { pluginKeys } from "~/hooks/usePlugins";
import { errorText, Section } from "./common";

type AccessMode = "everyone" | "roles";

const ACCESS_LABELS: Record<AccessMode, string> = {
  roles: "Roles the organization chooses",
  everyone: "Everyone in the organization",
};

/**
 * Superusers: which organizations use an approved plugin, and for whom
 * (docs/widget-plugins/DESIGN.md 8.5). Entity admins manage the same switch for their
 * own organization, along with role grants and narrowing.
 */
export function PluginEntities({ pluginId }: { pluginId: string }) {
  const queryClient = useQueryClient();
  const [bulkMode, setBulkMode] = useState<AccessMode>("roles");
  const { data } = useQuery({
    queryKey: pluginKeys.detail(pluginId),
    queryFn: () => getPlatformPlugin(pluginId),
  });

  const { mutate: update, isPending } = useMutation({
    mutationFn: (args: {
      entityUuid: string | null;
      enabled: boolean;
      access_mode?: AccessMode;
    }) =>
      putPluginEntity(pluginId, args.entityUuid, {
        enabled: args.enabled,
        ...(args.access_mode ? { access_mode: args.access_mode } : {}),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["widget-plugins"] }),
    onError: (error) => toast.error(errorText(error)),
  });

  if (!data) return null;

  return (
    <Section
      title="Enabled for"
      hint="A plugin does nothing for an organization until it is enabled there. With roles, the organization's admins choose which roles may use it."
    >
      <div className="flex flex-wrap items-center gap-2 body-xs-regular">
        <select
          aria-label="Who may use it in every organization"
          className="rounded border border-general-border-secondary bg-transparent p-1"
          value={bulkMode}
          onChange={(e) => setBulkMode(e.target.value as AccessMode)}
        >
          {(Object.keys(ACCESS_LABELS) as AccessMode[]).map((mode) => (
            <option key={mode} value={mode}>
              {ACCESS_LABELS[mode]}
            </option>
          ))}
        </select>
        <Button
          size="xs"
          variant="secondary"
          disabled={isPending}
          onClick={() =>
            update({ entityUuid: null, enabled: true, access_mode: bulkMode })
          }
        >
          Enable for all
        </Button>
        <Button
          size="xs"
          variant="secondary"
          disabled={isPending}
          onClick={() => update({ entityUuid: null, enabled: false })}
        >
          Disable for all
        </Button>
      </div>
      <table className="w-full body-xs-regular" data-testid="plugin-entities">
        <thead className="text-left text-ds-text-caption">
          <tr>
            <th className="py-1">Organization</th>
            <th>Enabled</th>
            <th>Who may use it</th>
          </tr>
        </thead>
        <tbody>
          {data.entities.map((entity) => (
            <EntityRow
              key={entity.entity_uuid}
              entity={entity}
              disabled={isPending}
              onChange={(enabled, access_mode) =>
                update({ entityUuid: entity.entity_uuid, enabled, access_mode })
              }
            />
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function EntityRow(props: {
  entity: PluginEntityUse;
  disabled: boolean;
  onChange: (enabled: boolean, accessMode?: AccessMode) => void;
}) {
  const { entity, disabled, onChange } = props;
  const name = entity.name ?? entity.entity_uuid;
  return (
    <tr className="border-t border-general-border-secondary">
      <td className="py-1.5">{name}</td>
      <td>
        <Switch
          aria-label={`Enabled for ${name}`}
          checked={entity.enabled}
          disabled={disabled}
          onCheckedChange={(on) => onChange(on)}
        />
      </td>
      <td>
        <select
          aria-label={`Who may use it in ${name}`}
          className="rounded border border-general-border-secondary bg-transparent p-1"
          value={entity.access_mode ?? "roles"}
          disabled={disabled || !entity.enabled}
          onChange={(e) => onChange(entity.enabled, e.target.value as AccessMode)}
        >
          {(Object.keys(ACCESS_LABELS) as AccessMode[]).map((mode) => (
            <option key={mode} value={mode}>
              {ACCESS_LABELS[mode]}
            </option>
          ))}
        </select>
      </td>
    </tr>
  );
}
