import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type KeyboardEvent, useId, useRef, useState } from "react";
import { toast } from "sonner";
import {
  createPluginPreset,
  deleteOrgPreset,
  deletePluginPreset,
  listPluginPresets,
  type PluginPreset,
  publishOrgPreset,
  updateOrgPreset,
  updatePluginPreset,
} from "~/api/plugins.api";
import { errorText } from "~/components/AdminPlugins/common";
import { Button } from "~/components/ds/atoms/Button";
import { Input } from "~/components/ds/atoms/Input";
import { Label } from "~/components/ds/atoms/Label";
import {
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "~/components/ds/atoms/Popover";
import { SelectTriggerVariants } from "~/components/ds/atoms/Select";
import { Tag } from "~/components/ds/atoms/Tag";
import { cn } from "~/components/ds/utils";
import Icon from "~/components/Icon";
import { pluginKeys } from "~/hooks/usePlugins";
import { useShallowAuthStore } from "~/lib/state/auth";
import { MAX_PRESET_NAME } from "./limits";

const ROW =
  "flex min-w-0 cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-btn-ghost-bg-hover focus-visible:bg-btn-ghost-bg-hover focus-visible:outline-hidden disabled:cursor-not-allowed disabled:text-general-label-disabled";

export function PresetsPanel(props: {
  pluginId: string;
  widgetId: string;
  config: Record<string, unknown>;
  state: unknown;
  onApply: (preset: PluginPreset) => void;
  disabled?: boolean;
}) {
  const { pluginId, widgetId, config, state, onApply, disabled } = props;
  const queryClient = useQueryClient();
  const queryKey = pluginKeys.presets(pluginId, widgetId);
  const labelId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => listPluginPresets(pluginId, widgetId),
    staleTime: 0,
  });
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const isAdmin = useShallowAuthStore((state) => state.user?.role === "Admin");

  const { mutate, isPending } = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (error) => toast.error(`Preset: ${errorText(error)}`),
  });

  const presets = data?.presets ?? [];
  const busy = disabled || isPending;
  const trimmed = text.trim();
  const needle = trimmed.toLowerCase();
  const shown = needle
    ? presets.filter((preset) => preset.name.toLowerCase().includes(needle))
    : presets;

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) setText("");
  };

  const save = () =>
    mutate(
      () =>
        createPluginPreset(pluginId, widgetId, {
          name: trimmed,
          config,
          state: state ?? null,
        }),
      { onSuccess: () => setText("") },
    );

  const applies = () =>
    Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-apply]") ?? []);

  const searchKeys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && trimmed && !busy) save();
    if (event.key === "ArrowDown") {
      event.preventDefault();
      applies()[0]?.focus();
    }
  };

  const rowKeys = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const all = applies();
    const next =
      all.indexOf(event.currentTarget) + (event.key === "ArrowDown" ? 1 : -1);
    if (next < 0) searchRef.current?.focus();
    else all[next]?.focus();
  };

  return (
    <div>
      <Label id={labelId}>Preset</Label>
      <PopoverRoot open={open} onOpenChange={changeOpen}>
        <PopoverTrigger asChild={true}>
          <button
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-labelledby={labelId}
            data-placeholder=""
            className={SelectTriggerVariants({ size: "sm" })}
          >
            <span className="line-clamp-1 text-left">Select a preset</span>
            <Icon id="chevron-down" className="size-4 text-ds-text-body" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="flex w-(--radix-popover-trigger-width) flex-col gap-2 space-y-0 p-2 only-sm:z-[62]"
        >
          <Input
            ref={searchRef}
            size="sm"
            aria-label="Search presets or name a new one"
            placeholder="Search or name a preset"
            prefix={<Icon id="search" className="size-4" />}
            value={text}
            maxLength={MAX_PRESET_NAME}
            disabled={disabled}
            onChange={setText}
            onKeyDown={searchKeys}
          />
          {trimmed ? (
            <button type="button" disabled={busy} className={ROW} onClick={save}>
              <Icon id="plus" className="size-4 shrink-0" />
              <span className="body-xs-medium min-w-0 truncate">
                {`Save current settings as “${trimmed}”`}
              </span>
            </button>
          ) : null}
          {isLoading ? (
            <p className="body-xs-regular px-2 py-1 text-ds-text-caption">
              Loading presets
            </p>
          ) : shown.length ? (
            <ul ref={listRef} className="flex max-h-56 flex-col overflow-y-auto">
              {shown.map((preset) => {
                const manageable = preset.scope === "user" || isAdmin;
                return (
                  <li
                    key={preset.id}
                    className="flex items-center gap-1"
                    data-preset={preset.id}
                  >
                    <button
                      type="button"
                      data-apply=""
                      aria-label={`Apply ${preset.name}`}
                      title="Apply"
                      disabled={disabled}
                      className={cn(ROW, "flex-1")}
                      onKeyDown={rowKeys}
                      onClick={() => {
                        onApply(preset);
                        changeOpen(false);
                      }}
                    >
                      <span className="body-xs-medium min-w-0 truncate">
                        {preset.name}
                      </span>
                      {preset.scope === "org" ? <Tag>Organization</Tag> : null}
                      {preset.is_default ? <Tag color="brand">Default</Tag> : null}
                    </button>
                    {manageable ? (
                      <>
                        {preset.is_default ? null : (
                          <Button
                            size="xs"
                            variant="ghost"
                            icon={true}
                            aria-label="Set as default"
                            title="Set as default"
                            disabled={busy}
                            onClick={() =>
                              mutate(() =>
                                (preset.scope === "user"
                                  ? updatePluginPreset
                                  : updateOrgPreset)(pluginId, widgetId, preset.id, {
                                  is_default: true,
                                }),
                              )
                            }
                          >
                            <Icon id="star-outline-icon" className="size-4" />
                          </Button>
                        )}
                        {preset.scope === "user" && isAdmin ? (
                          <Button
                            size="xs"
                            variant="ghost"
                            icon={true}
                            aria-label="Publish to organization"
                            title="Publish to organization"
                            disabled={busy}
                            onClick={() =>
                              mutate(() =>
                                publishOrgPreset(pluginId, widgetId, {
                                  name: preset.name,
                                  config: preset.config,
                                  state: preset.state,
                                }),
                              )
                            }
                          >
                            <Icon id="building-06" className="size-4" />
                          </Button>
                        ) : null}
                        <Button
                          size="xs"
                          variant="ghost"
                          icon={true}
                          className="text-alert-error"
                          aria-label="Delete"
                          title="Delete"
                          disabled={busy}
                          onClick={() =>
                            mutate(() =>
                              (preset.scope === "user"
                                ? deletePluginPreset
                                : deleteOrgPreset)(pluginId, widgetId, preset.id),
                            )
                          }
                        >
                          <Icon id="trash-04" className="size-4" />
                        </Button>
                      </>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : presets.length ? (
            <p className="body-xs-regular px-2 py-1 text-ds-text-caption">
              No presets match.
            </p>
          ) : (
            <p className="body-xs-regular px-2 py-1 text-ds-text-caption">
              No presets yet. Type a name to save the current settings.
            </p>
          )}
        </PopoverContent>
      </PopoverRoot>
    </div>
  );
}
