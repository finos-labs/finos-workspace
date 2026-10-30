import get from "lodash/get";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { callPluginBackend, callPluginProxy } from "~/api/plugins.api";
import DraggableCard from "~/components/DraggableCard";
import { ExternalLinkDialog } from "~/components/ExternalLinkDialog";
import SearchResultsNotFound from "~/components/General/SearchResultsNotFound";
import type { ParamDef, StoredParamValue } from "~/components/types";
import { useWidgetContext } from "~/components/Widget.context";
import { useWidgetParamsPositions } from "~/components/WidgetParams/QueryParams";
import { buildIframeWidget } from "~/components/Widgets/custom/buildIframeWidget";
import {
  RowsToggle,
  useRawRows,
  useRowsView,
} from "~/components/Widgets/Helpers/RawRows";
import { useParamGroupBindings } from "~/components/Widgets/Helpers/useParamGroupBindings";
import { useJsonData } from "~/lib/api";
import { useShallowAppStore } from "~/lib/state/app";
import { useSourceCredentials } from "~/lib/state/backendConnector";
import { useShallowThemeStore } from "~/lib/state/theme";
import { buildWidgetRequest } from "~/lib/utils/widgetRequest";
import {
  assetPath,
  checkStateWrite,
  coerceParamValue,
  commandPermission,
  exportFile,
  jsonSize,
  RateLimiter,
  readExportOptions,
  safeFilename,
  safeLink,
  serverCallError,
  serverCallRequest,
  type TraitBinding,
  traitBindings,
} from "./authority";
import { BundleIntegrityError, loadAsset } from "./bundle";
import { validateDefinition } from "./definition";
import PluginFrame, { type FrameStatus, type PluginFrameHandle } from "./PluginFrame";
import { CommandError, MAX_EXPORT_BYTES } from "./protocol";
import {
  resolvePluginWidget,
  resolveVizHandler,
  usePluginRegistryStore,
  useRowsPlugin,
} from "./registry";
import { cleanSettings, SettingsForm } from "./SettingsForm";
import { readThemeTrait } from "./theme";
import {
  MAX_CONFIG_BYTES,
  type PluginInstanceStorage,
  type ResolvedPluginWidget,
} from "./types";

const MAX_COPILOT_CONTEXT_BYTES = 256 * 1024;
const MAX_NOTIFY_LENGTH = 500;

export function useResolvedPluginWidget(): ResolvedPluginWidget | null {
  const { widget, widgetFromJSON } = useWidgetContext();
  const { plugins, vizHandlers } = usePluginRegistryStore((state) => ({
    plugins: state.plugins,
    vizHandlers: state.vizHandlers,
  }));
  return useMemo(() => {
    if (widget.plugin) return resolvePluginWidget(widget.plugin, { plugins });
    return resolveVizHandler(widgetFromJSON?.type ?? widget.type, {
      plugins,
      vizHandlers,
    });
  }, [widget.plugin, widget.type, widgetFromJSON?.type, plugins, vizHandlers]);
}

function Unavailable(props: { title: string; message: string; detail?: string }) {
  return (
    <DraggableCard title={props.title}>
      <SearchResultsNotFound
        icon={true}
        firstMessage={props.message}
        secondMessage={props.detail ?? ""}
      />
    </DraggableCard>
  );
}

const STATUS_MESSAGES: Partial<Record<FrameStatus["kind"], string>> = {
  "sandbox-failed": "Plugin sandbox unavailable",
  "integrity-failed":
    "Failed to load: the plugin's files do not match the approved version",
  "load-failed": "Failed to load",
  "plugin-error": "Plugin error",
  unresponsive: "Not responding",
  ended: "The widget was stopped",
};

export default function PluginWidget() {
  const resolved = useResolvedPluginWidget();
  const { widget } = useWidgetContext();
  const loaded = usePluginRegistryStore((state) => state.loaded);
  const [showRows] = useRowsView();
  const rowsPlugin = useRowsPlugin(widget.data?.rawType);

  if (!resolved) {
    return (
      <Unavailable
        title={widget.name}
        message={
          loaded ? "This widget type is not available to you" : "Loading widget plugins"
        }
        detail={
          loaded
            ? "An administrator decides which widget plugins your roles may use."
            : undefined
        }
      />
    );
  }
  const shown = showRows && rowsPlugin ? rowsPlugin : resolved;
  return (
    <PluginWidgetBody
      key={`${shown.plugin.id}:${shown.widget.id}:${showRows}`}
      resolved={shown}
      showRows={showRows}
      viewName={resolved.widget.name}
    />
  );
}

export function PluginRowsCard(props: {
  resolved: ResolvedPluginWidget;
  viewName: string;
}) {
  return (
    <PluginWidgetBody
      resolved={props.resolved}
      showRows={true}
      viewName={props.viewName}
    />
  );
}

function PluginWidgetBody({
  resolved,
  showRows,
  viewName,
}: {
  resolved: ResolvedPluginWidget;
  showRows: boolean;
  viewName: string;
}) {
  const { plugin, widget: pluginWidget, vizType } = resolved;
  const { widget, updateWidget, activeDashboardId, isShared } = useWidgetContext();
  const addWidget = useShallowAppStore((state) => state.addWidget);
  const theme = useShallowThemeStore((state) => state.theme);
  const frameRef = useRef<PluginFrameHandle>(null);
  const [status, setStatus] = useState<FrameStatus>({ kind: "booting" });
  const [link, setLink] = useState<string | null>(null);
  const [copilotContext, setCopilotContext] = useState<unknown>(undefined);
  const notifyLimiter = useRef(new RateLimiter(0.5, 5));
  const serverLimiter = useRef(new RateLimiter(2, 10));
  const { updateGroupedParams } = useParamGroupBindings();

  const permissions = useMemo(() => new Set(pluginWidget.permissions), [pluginWidget]);
  const bindings = useMemo(
    () => traitBindings(pluginWidget, permissions),
    [pluginWidget, permissions],
  );
  const storagePlugin = (widget.storage?.plugin ?? {}) as PluginInstanceStorage;
  const paramDefs = (widget.params ?? []) as ParamDef[];
  const paramValues = (widget.storage?.params ?? {}) as Record<
    string,
    StoredParamValue
  >;

  const handle = pluginWidget.handles.find((h) => h.type === vizType);
  const endpointUrl = widget.endpoint?.url ?? "";
  const readsData = permissions.has("core:data:read") && !!endpointUrl;
  const [, setShowRows] = useRowsView();
  const rows = useRawRows(widget);
  const credentials = useSourceCredentials(widget.sourceId, endpointUrl);
  const request = useMemo(
    () =>
      buildWidgetRequest(widget, credentials, {
        theme: theme === "light" ? "light" : "dark",
      }),
    [widget.endpoint, widget.params, widget.storage?.params, theme, credentials],
  );
  const dataKey = widget.data?.dataKey;
  const answer = useJsonData(
    {
      request,
      responseCb: async (response, resolve) => {
        const json = await response.json();
        resolve(dataKey ? get(json, dataKey, json) : json);
      },
    },
    { enabled: readsData && !showRows, staleTime: widget.staleTime ?? 1000 * 60 * 15 },
  );
  const { data: fetched, isLoading, error, dataUpdatedAt } = showRows ? rows : answer;
  const data = showRows || endpointUrl ? fetched : storagePlugin.data;

  const refreshed = useRef(widget.refreshQuery);
  useEffect(() => {
    if (widget.refreshQuery === refreshed.current) return;
    refreshed.current = widget.refreshQuery;
    frameRef.current?.sendEvent({ kind: "workspace-event", name: "refresh" });
  }, [widget.refreshQuery]);

  const definitionValue = vizType ? widget.data?.[vizType] : undefined;
  const definitionErrors = useMemo(
    () =>
      handle?.definition
        ? validateDefinition(definitionValue ?? {}, handle.definition)
        : definitionValue === undefined
          ? []
          : [{ path: "", message: "this plugin takes no configuration for the type" }],
    [handle, definitionValue],
  );

  const config = useMemo(
    () => ({
      ...(pluginWidget.settings?.defaults ?? {}),
      ...cleanSettings(pluginWidget.settings?.schema, storagePlugin.config),
    }),
    [pluginWidget.settings, storagePlugin.config],
  );
  const traits = useMemo(() => {
    const values: Record<string, unknown> = {};
    const declaredParams = Object.fromEntries(
      paramDefs.map((p) => [p.paramName, paramValues[p.paramName] ?? null]),
    );
    for (const binding of bindings) {
      switch (binding.source) {
        case "data":
          values[binding.trait] = data;
          break;
        case "params":
          values[binding.trait] = declaredParams;
          break;
        case "param":
          values[binding.trait] = declaredParams[binding.key ?? ""] ?? null;
          break;
        case "definition":
          values[binding.trait] = definitionValue ?? {};
          break;
        case "config":
          values[binding.trait] =
            binding.key === undefined ? config : config[binding.key];
          break;
        case "adminSettings":
          values[binding.trait] =
            binding.key === undefined
              ? plugin.adminSettings
              : plugin.adminSettings[binding.key];
          break;
        case "state":
          values[binding.trait] = storagePlugin.state ?? null;
          break;
        case "theme":
          values[binding.trait] = readThemeTrait(theme);
          break;
        case "capabilities":
          values[binding.trait] = [...permissions].sort();
          break;
        case "meta":
          values[binding.trait] = {
            pluginId: plugin.id,
            version: plugin.version,
            widgetId: pluginWidget.id,
            instanceId: widget.id,
          };
          break;
      }
    }
    return values;
  }, [
    bindings,
    data,
    paramDefs,
    paramValues,
    definitionValue,
    config,
    plugin,
    storagePlugin.state,
    theme,
    permissions,
    pluginWidget.id,
    widget.id,
  ]);

  const writeParams = useCallback(
    (changes: Record<string, unknown>) => {
      const accepted: Record<string, StoredParamValue> = {};
      for (const [name, value] of Object.entries(changes)) {
        const param = paramDefs.find((p) => p.paramName === name);
        if (!param)
          throw new CommandError("out_of_scope", `${name} is not a declared param`);
        accepted[name] = coerceParamValue(param, value) as StoredParamValue;
      }
      if (isShared)
        throw new CommandError("unavailable", "a shared dashboard is read-only");
      updateWidget((prev) => ({
        ...prev,
        storage: { ...prev.storage, params: { ...prev.storage?.params, ...accepted } },
      }));
      updateGroupedParams(
        Object.fromEntries(
          Object.entries(accepted).map(([k, v]) => [
            k,
            Array.isArray(v) ? v.join(",") : String(v ?? ""),
          ]),
        ),
      );
      return accepted;
    },
    [paramDefs, updateWidget, updateGroupedParams, isShared],
  );

  const onWrite = useCallback(
    (binding: TraitBinding, value: unknown) => {
      switch (binding.source) {
        case "params": {
          if (typeof value !== "object" || value === null || Array.isArray(value))
            throw new CommandError("invalid_args", "params is an object");
          const changed = Object.fromEntries(
            Object.entries(value).filter(
              ([name, v]) =>
                JSON.stringify(v) !== JSON.stringify(paramValues[name] ?? null),
            ),
          );
          const accepted = writeParams(changed);
          return { ...(traits[binding.trait] as object), ...accepted };
        }
        case "param": {
          const accepted = writeParams({ [binding.key ?? ""]: value });
          return accepted[binding.key ?? ""];
        }
        case "state": {
          const next = checkStateWrite(value);
          if (isShared)
            throw new CommandError("unavailable", "a shared dashboard is read-only");
          updateWidget((prev) => ({
            ...prev,
            storage: {
              ...prev.storage,
              plugin: {
                ...(prev.storage?.plugin as PluginInstanceStorage),
                state: next,
              },
            },
          }));
          return next;
        }
        default:
          throw new CommandError("not_granted", `${binding.trait} is read-only`);
      }
    },
    [writeParams, paramValues, traits, updateWidget, isShared],
  );

  const onCommand = useCallback(
    async (name: string, msg: unknown, buffers: ArrayBuffer[]) => {
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
          if (!notifyLimiter.current.take())
            throw new CommandError("rate_limited", "too many notifications");
          const text = String(args.text ?? "").slice(0, MAX_NOTIFY_LENGTH);
          const level = ["success", "warning", "error"].includes(String(args.level))
            ? (args.level as "success" | "warning" | "error")
            : "info";
          toast[level](text, { description: plugin.name });
          return {};
        }
        case "core:ui:open-link":
          setLink(safeLink(args.url));
          return {};
        case "core:clipboard:write": {
          const text = String(args.text ?? "");
          if (text.length > 1024 * 1024)
            throw new CommandError("too_large", "at most 1 MiB");
          await navigator.clipboard.writeText(text).catch(() => {
            throw new CommandError("unavailable", "the clipboard refused the write");
          });
          return {};
        }
        case "core:download:save": {
          const [bytes] = buffers;
          if (!bytes)
            throw new CommandError("invalid_args", "the file is the first buffer");
          if (bytes.byteLength > MAX_EXPORT_BYTES)
            throw new CommandError("too_large", "at most 25 MiB");
          const mime =
            typeof args.mime === "string"
              ? args.mime.slice(0, 100)
              : "application/octet-stream";
          download(new Blob([bytes], { type: mime }), safeFilename(args.filename));
          return {};
        }
        case "core:proxy:call": {
          const call = serverCallRequest(args, "id", pluginWidget.proxies);
          if (!serverLimiter.current.take())
            throw new CommandError("rate_limited", "too many server calls");
          const answer = await callPluginProxy(plugin.id, call.name, {
            widget: pluginWidget.id,
            args: call.args,
          }).catch((error) => {
            throw serverCallError(error);
          });
          return { value: answer.body };
        }
        case "core:backend:call": {
          const call = serverCallRequest(args, "route", pluginWidget.routes);
          if (!serverLimiter.current.take())
            throw new CommandError("rate_limited", "too many server calls");
          const answer = await callPluginBackend(plugin.id, call.name, {
            widget: pluginWidget.id,
            instance: widget.id,
            args: call.args,
          }).catch((error) => {
            throw serverCallError(error);
          });
          return { value: answer.body };
        }
        default:
          throw new CommandError("unknown_command", `${name} is not a host command`);
      }
    },
    [
      permissions,
      plugin,
      pluginWidget.id,
      pluginWidget.proxies,
      pluginWidget.routes,
      widget.id,
    ],
  );

  const exportsAvailable = status.kind === "running" ? status.exports : [];
  const canExport =
    permissions.has("core:export:provide") &&
    exportsAvailable.includes("exportOptions") &&
    exportsAvailable.includes("exportData");
  const setExportWidgetData = useShallowThemeStore(
    (state) => state.setExportWidgetData,
  );
  const onExport = useCallback(async () => {
    const frame = frameRef.current;
    if (!frame) return;
    try {
      const options = readExportOptions(await frame.callExport("exportOptions", []));
      if (!options.length) {
        toast.info("Nothing to export right now", { description: plugin.name });
        return;
      }
      setExportWidgetData({
        widgetId: widget.id,
        widgetName: widget.name,
        selectedExportFormat: options[0].id,
        possibleExportFormats: options.map((option) => ({
          value: option.id,
          label: option.label,
          fn: (title: string) => {
            frame
              .callExport("exportData", [option.id, { title }])
              .then((value) => {
                const file = exportFile(value, option);
                if (!file) {
                  toast.info("Nothing to export right now", {
                    description: plugin.name,
                  });
                  return;
                }
                download(file, `${safeFilename(title)}.${option.extension}`);
              })
              .catch((error) =>
                toast.error(`Export failed: ${error?.message ?? error}`),
              );
          },
        })),
      });
    } catch (error) {
      toast.error(
        `Export failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }, [plugin.name, setExportWidgetData, widget.id, widget.name]);

  const wantsCopilotContext =
    !widget.raw &&
    permissions.has("core:copilot:context") &&
    exportsAvailable.includes("copilotContext");
  useEffect(() => {
    if (!wantsCopilotContext) return;
    frameRef.current
      ?.callExport("copilotContext", [])
      .then((value) => {
        if (jsonSize(value) <= MAX_COPILOT_CONTEXT_BYTES) setCopilotContext(value);
      })
      .catch(() => undefined);
  }, [wantsCopilotContext, data]);

  const settingsSchema = pluginWidget.settings?.schema;
  const [draft, setDraft] = useState<Record<string, unknown>>(config);
  useEffect(() => setDraft(config), [config]);
  const saveSettings = useCallback(() => {
    const next = cleanSettings(settingsSchema, draft);
    if (jsonSize(next) > MAX_CONFIG_BYTES) {
      toast.error("These settings are too large");
      return;
    }
    updateWidget((prev) => ({
      ...prev,
      storage: {
        ...prev.storage,
        plugin: { ...(prev.storage?.plugin as PluginInstanceStorage), config: next },
      },
    }));
  }, [draft, settingsSchema, updateWidget]);

  const { renderRow0Params, renderBelowNavbarRows } = useWidgetParamsPositions();

  if (definitionErrors.length) {
    return (
      <Unavailable
        title={widget.name}
        message={`This widget's ${vizType} configuration does not match what ${plugin.name} expects`}
        detail={definitionErrors
          .slice(0, 5)
          .map((e) => `data.${vizType}${e.path}: ${e.message}`)
          .join("; ")}
      />
    );
  }

  const failure = STATUS_MESSAGES[status.kind];
  const failureDetail =
    status.kind === "sandbox-failed"
      ? `Checks that failed: ${status.checks.join(", ")}`
      : "detail" in status
        ? status.detail
        : undefined;

  return (
    <>
      <DraggableCard
        title={widget.name}
        elementRightNextToTitle={renderRow0Params}
        elementBelowNavbar={renderBelowNavbarRows}
        aiEnabled={true}
        aiData={
          widget.raw
            ? rows.data
            : copilotContext === undefined
              ? data
              : { data, context: copilotContext }
        }
        extraNavbarElements={
          widget.raw ? (
            <RowsToggle
              showRows={showRows}
              onChange={setShowRows}
              viewName={viewName}
            />
          ) : undefined
        }
        lastUpdated={readsData ? dataUpdatedAt : undefined}
        loading={readsData && isLoading}
        error={readsData ? error : undefined}
        errorMessage={error?.message}
        settings={{ overrideSettings: false, showExport: canExport }}
        onExport={canExport ? onExport : undefined}
        settingsModalChildren={
          settingsSchema && Object.keys(settingsSchema.properties ?? {}).length ? (
            <SettingsForm
              schema={settingsSchema}
              values={draft}
              onChange={setDraft}
              disabled={isShared}
            />
          ) : null
        }
        onSaveSettings={saveSettings}
        keepMounted={true}
      >
        <div className="relative h-full w-full" data-plugin={plugin.id}>
          {failure ? (
            <SearchResultsNotFound
              icon={true}
              firstMessage={failure}
              secondMessage={failureDetail ?? ""}
              children={
                <button
                  type="button"
                  className="ws-hyper-link mt-2 body-xs-medium"
                  onClick={() => frameRef.current?.restart()}
                >
                  Retry
                </button>
              }
            />
          ) : null}
          <div className={failure ? "hidden" : "h-full w-full"}>
            <PluginFrame
              plugin={plugin}
              title={`${widget.name} (${plugin.name})`}
              bindings={bindings}
              traits={traits}
              permissions={[...permissions].sort()}
              onWrite={onWrite}
              onCommand={onCommand}
              onStatus={setStatus}
              colorScheme={theme === "light" ? "light" : "dark"}
              handleRef={frameRef}
            />
          </div>
        </div>
      </DraggableCard>
      <ExternalLinkDialog
        open={link !== null}
        url={link ?? ""}
        onClose={() => setLink(null)}
        onOpenInIframe={(url) =>
          addWidget(
            activeDashboardId,
            buildIframeWidget(url, widget.name, widget.innerTab),
          )
        }
        onOpenInNewTab={(url) => window.open(url, "_blank", "noopener,noreferrer")}
      />
    </>
  );
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
