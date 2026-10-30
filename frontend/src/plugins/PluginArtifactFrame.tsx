import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { PluginArtifactT } from "~/lib/state/copilot";
import { useShallowThemeStore } from "~/lib/state/theme";
import { assetPath, commandPermission, traitBindings } from "./authority";
import { BundleIntegrityError, loadAsset } from "./bundle";
import PluginFrame, { type FrameStatus } from "./PluginFrame";
import { CommandError } from "./protocol";
import { resolvePluginWidget, usePluginRegistryStore } from "./registry";
import { cleanSettings } from "./SettingsForm";
import { readThemeTrait } from "./theme";

const IN_CHAT = new Set([
  "core:default",
  "core:data:read",
  "core:ui:notify",
  "core:clipboard:write",
]);
const ROW_PX = 25;
const MAX_NOTIFY_LENGTH = 500;

const FAILURES: Partial<Record<FrameStatus["kind"], string>> = {
  "sandbox-failed": "Plugin sandbox unavailable",
  "integrity-failed":
    "Failed to load: the plugin's files do not match the approved version",
  "load-failed": "Failed to load",
  "plugin-error": "Plugin error",
  unresponsive: "Not responding",
  ended: "The component was stopped",
};

export function PluginArtifactFrame({ artifact }: { artifact: PluginArtifactT }) {
  const loaded = usePluginRegistryStore((state) => state.loaded);
  const plugins = usePluginRegistryStore((state) => state.plugins);
  const theme = useShallowThemeStore((state) => state.theme);
  const [status, setStatus] = useState<FrameStatus>({ kind: "booting" });
  const resolved = useMemo(
    () => resolvePluginWidget(artifact.plugin, { plugins }),
    [artifact.plugin, plugins],
  );

  const view = useMemo(() => {
    if (!resolved) return null;
    const { plugin, widget } = resolved;
    const permissions = new Set(widget.permissions.filter((p) => IN_CHAT.has(p)));
    permissions.add("core:default");
    const bindings = traitBindings(widget, permissions).map((b) => ({
      ...b,
      writable: false,
    }));
    const config = {
      ...(widget.settings?.defaults ?? {}),
      ...cleanSettings(widget.settings?.schema, artifact.config),
    };
    const traits: Record<string, unknown> = {};
    for (const binding of bindings) {
      switch (binding.source) {
        case "data":
          traits[binding.trait] = artifact.data;
          break;
        case "config":
          traits[binding.trait] =
            binding.key === undefined ? config : config[binding.key];
          break;
        case "adminSettings":
          traits[binding.trait] =
            binding.key === undefined
              ? plugin.adminSettings
              : plugin.adminSettings[binding.key];
          break;
        case "theme":
          traits[binding.trait] = readThemeTrait(theme);
          break;
        case "capabilities":
          traits[binding.trait] = [...permissions].sort();
          break;
        case "meta":
          traits[binding.trait] = {
            pluginId: plugin.id,
            version: plugin.version,
            widgetId: widget.id,
            instanceId: artifact.uuid,
          };
          break;
        case "params":
          traits[binding.trait] = {};
          break;
        case "definition":
          traits[binding.trait] = {};
          break;
        default:
          traits[binding.trait] = null;
      }
    }
    return { plugin, widget, permissions, bindings, traits };
  }, [resolved, artifact.data, artifact.config, artifact.uuid, theme]);

  if (!(resolved && view))
    return (
      <div className="p-3 text-xs text-ds-text-caption">
        {loaded
          ? "This component is not available to you. An administrator decides which widget plugins your roles may use."
          : "Loading widget plugins"}
      </div>
    );

  const { plugin, widget, permissions, bindings, traits } = view;
  const failure = FAILURES[status.kind];
  const height = Math.min(600, Math.max(200, widget.grid.h * ROW_PX));

  return (
    <div style={{ height }} className="relative w-full" data-plugin={plugin.id}>
      {failure ? (
        <div className="p-3 text-xs text-ds-text-caption">
          {failure}
          {"detail" in status ? `: ${status.detail}` : ""}
        </div>
      ) : null}
      <div className={failure ? "hidden" : "h-full w-full"}>
        <PluginFrame
          plugin={plugin}
          title={`${artifact.name ?? widget.name} (${plugin.name})`}
          bindings={bindings}
          traits={traits}
          permissions={[...permissions].sort()}
          onWrite={() => {
            throw new CommandError("not_granted", "a chat artifact is read-only");
          }}
          onCommand={async (name, msg) => {
            commandPermission(name, permissions);
            const args = (typeof msg === "object" && msg !== null ? msg : {}) as Record<
              string,
              unknown
            >;
            switch (name) {
              case "core:asset:read": {
                const path = assetPath(args);
                const bytes = await loadAsset(plugin, path).catch((error) => {
                  throw error instanceof BundleIntegrityError
                    ? new CommandError(
                        "out_of_scope",
                        `${path} is not a file of this version under assets/`,
                      )
                    : new CommandError("unavailable", `${path} could not be read`);
                });
                return { value: { path, size: bytes.byteLength }, buffers: [bytes] };
              }
              case "core:ui:notify": {
                const text = String(args.text ?? "").slice(0, MAX_NOTIFY_LENGTH);
                toast.info(text, { description: plugin.name });
                return {};
              }
              case "core:clipboard:write": {
                const text = String(args.text ?? "");
                if (text.length > 1024 * 1024)
                  throw new CommandError("too_large", "at most 1 MiB");
                await navigator.clipboard.writeText(text).catch(() => {
                  throw new CommandError(
                    "unavailable",
                    "the clipboard refused the write",
                  );
                });
                return {};
              }
              default:
                throw new CommandError(
                  "unknown_command",
                  `${name} is not available in the chat`,
                );
            }
          }}
          onStatus={setStatus}
          colorScheme={theme === "light" ? "light" : "dark"}
        />
      </div>
    </div>
  );
}
