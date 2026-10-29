import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  getEntityPlugins,
  getRolePluginAccess,
  type PluginGrant,
  putRolePluginAccess,
} from "~/api/plugins.api";
import { pluginKeys } from "~/hooks/usePlugins";
import { Button } from "../ds/atoms/Button";
import { Checkbox } from "../ds/atoms/Checkbox";
import { BaseDialog } from "../ds/dialogs/BaseDialog";
import { DialogFooter, DialogTitle } from "../ds/dialogs/Dialog";
import type { RoleT } from "./types";

interface Props {
  open: boolean;
  onClose: () => void;
  role: RoleT | null;
}

const ALL = "*";
const key = (pluginId: string, widgetId: string) => `${pluginId}\u0000${widgetId}`;

export default function RolePluginAccessDialog({ open, onClose, role }: Props) {
  const queryClient = useQueryClient();
  const roleUuid = role?.uuid ?? "";

  const { data: plugins } = useQuery({
    queryKey: pluginKeys.entity,
    queryFn: getEntityPlugins,
    enabled: open,
  });
  const { data: granted, isLoading } = useQuery({
    queryKey: pluginKeys.role(roleUuid),
    queryFn: () => getRolePluginAccess(roleUuid),
    enabled: open && !!roleUuid,
    staleTime: 0,
  });

  const [grants, setGrants] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (granted) setGrants(new Set(granted.map((g) => key(g.plugin_id, g.widget_id))));
  }, [granted]);

  const toggle = (pluginId: string, widgetId: string, on: boolean) => {
    const next = new Set(grants);
    if (on) next.add(key(pluginId, widgetId));
    else next.delete(key(pluginId, widgetId));
    setGrants(next);
  };

  const { mutate: save, isPending } = useMutation({
    mutationFn: () =>
      putRolePluginAccess(
        roleUuid,
        [...grants].map((k) => {
          const [plugin_id, widget_id] = k.split("\u0000");
          return { plugin_id, widget_id } satisfies PluginGrant;
        }),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pluginKeys.role(roleUuid) });
      queryClient.invalidateQueries({ queryKey: pluginKeys.entity });
      toast.success("Widget plugin access saved");
      onClose();
    },
    onError: () => toast.error("Failed to save the widget plugin access"),
  });

  if (!role) return null;
  const list = plugins?.plugins ?? [];

  return (
    <BaseDialog
      open={open}
      onClose={onClose}
      className="max-w-md lg:max-w-2xl max-h-[760px] overflow-y-auto"
    >
      <DialogTitle>Widget plugins - {role.name}</DialogTitle>
      <p className="body-xs-regular text-ds-text-caption">
        Choose the plugin widgets the members of this role may use. Nothing is open by
        default: a plugin set to "roles only" for your organization is available only to
        the roles that are given it here.
      </p>

      {!granted ? (
        <p className="mt-4 body-xs-regular text-ds-text-caption">
          {isLoading ? "Loading..." : "The access of this role could not be loaded."}
        </p>
      ) : list.length === 0 ? (
        <p className="mt-4 body-xs-regular text-ds-text-caption">
          No widget plugin is approved on this FINOS Workspace.
        </p>
      ) : (
        <section className="mt-4 flex flex-col gap-3" data-testid="role-plugin-access">
          {list.map((plugin) => {
            const all = grants.has(key(plugin.plugin_id, ALL));
            return (
              <div key={plugin.plugin_id} className="flex flex-col gap-1">
                <span className="body-xs-medium">
                  {plugin.name}{" "}
                  <span className="text-ds-text-caption">
                    ({plugin.enabled ? "enabled" : "not enabled for your organization"})
                  </span>
                </span>
                <Checkbox
                  label="All widgets of this plugin"
                  checked={all}
                  onCheckedChange={(on) => toggle(plugin.plugin_id, ALL, on === true)}
                />
                {plugin.widgets.map((widget) => (
                  <Checkbox
                    key={widget.id}
                    label={`${widget.name}${widget.handles.length ? ` (renders ${widget.handles.join(", ")})` : ""}`}
                    disabled={all}
                    checked={all || grants.has(key(plugin.plugin_id, widget.id))}
                    onCheckedChange={(on) =>
                      toggle(plugin.plugin_id, widget.id, on === true)
                    }
                  />
                ))}
              </div>
            );
          })}
        </section>
      )}

      <DialogFooter>
        <Button variant="secondary" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={isPending || !granted}
          onClick={() => save()}
        >
          Save
        </Button>
      </DialogFooter>
    </BaseDialog>
  );
}
