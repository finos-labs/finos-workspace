import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

/**
 * Superusers: which organizations use an approved plugin (docs/widget-plugins/DESIGN.md
 * 8.5). Entity admins manage the same switch for their own organization, along with the
 * role grants that give its widgets to users, and narrowing.
 */
export function PluginEntities({ pluginId }: { pluginId: string }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: pluginKeys.detail(pluginId),
    queryFn: () => getPlatformPlugin(pluginId),
  });

  const { mutate: update, isPending } = useMutation({
    mutationFn: (args: { entityUuid: string | null; enabled: boolean }) =>
      putPluginEntity(pluginId, args.entityUuid, { enabled: args.enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["widget-plugins"] }),
    onError: (error) => toast.error(errorText(error)),
  });

  if (!data) return null;

  return (
    <Section
      title="Enabled for"
      hint="A plugin does nothing for an organization until it is enabled there. The organization's admins then choose which roles may use it."
    >
      <div className="flex flex-wrap items-center gap-2 body-xs-regular">
        <Button
          size="xs"
          variant="secondary"
          disabled={isPending}
          onClick={() => update({ entityUuid: null, enabled: true })}
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
          </tr>
        </thead>
        <tbody>
          {data.entities.map((entity) => (
            <EntityRow
              key={entity.entity_uuid}
              entity={entity}
              disabled={isPending}
              onChange={(enabled) =>
                update({ entityUuid: entity.entity_uuid, enabled })
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
  onChange: (enabled: boolean) => void;
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
    </tr>
  );
}
