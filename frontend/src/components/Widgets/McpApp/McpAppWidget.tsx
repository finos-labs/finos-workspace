// Copyright FINOS contributors. Licensed under the Apache License, Version 2.0.
//
// MCP Apps widget. Shows the interactive UI that an MCP
// server links to one of its tools (`_meta.ui.resourceUri`) inside a dashboard
// card. The UI runs on a separate sandbox origin; see public/mcp-app-sandbox.html.
// Every request the UI makes goes through Workspace's own MCP connection, so
// the backend's per-role tool checks, OAuth and SSRF guards still apply.

import {
  AppBridge,
  buildAllowAttribute,
  type McpUiHostContext,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import DraggableCard from "~/components/DraggableCard";
import { Button } from "~/components/ds/atoms/Button";
import { ConfirmDialog } from "~/components/ds/dialogs/ConfirmDialog";
import { useWidgetContext } from "~/components/Widget.context";
import { getConfig } from "~/lib/runtimeConfig";
import { useCopilotDataStore } from "~/lib/state/copilotData";
import { useMcpToolsStore, useShallowMcpToolsStore } from "~/lib/state/mcpTools";
import { useShallowThemeStore } from "~/lib/state/theme";
import {
  type AppModelContext,
  appCallNeedsConsent,
  appMayCallTool,
  checkSandboxOrigin,
  contextFromApp,
  contextFromToolResult,
  defaultTool,
  HOST_REFUSAL_CODE,
  INNER_SANDBOX,
  type McpAppConfig,
  OUTER_SANDBOX,
  parseUiResource,
  runPrompt,
  safeLink,
  sandboxBaseFor,
  sandboxFrameUrl,
  sandboxIdFor,
  toolTitle,
  toolUiResourceUri,
  type UiResource,
  widgetNameForTool,
} from "./mcpAppHost";
import { useCallConsent } from "./useCallConsent";

const HOST_INFO = { name: "FINOS Workspace", version: "0.1.0" };
const TEARDOWN_TIMEOUT_MS = 2000;
const RECONNECT_DELAYS_MS = [2000, 5000, 15000];

const refuse = (message: string) => new McpError(HOST_REFUSAL_CODE, message);

function Notice({
  children,
  tone = "info",
}: {
  children: React.ReactNode;
  tone?: "info" | "error";
}) {
  return (
    <div
      className={`m-3 rounded border p-3 text-sm ${
        tone === "error"
          ? "border-red-400/50 text-red-500"
          : "border-light-200 dark:border-dark-600"
      }`}
    >
      {children}
    </div>
  );
}

function ConfigForm({
  initial,
  onSave,
}: {
  initial: McpAppConfig | undefined;
  onSave: (config: McpAppConfig, title: string) => void;
}) {
  const servers = useShallowMcpToolsStore((s) =>
    s.servers
      .filter((server) => server.enabled && !server.iframeWidgetId)
      .map((server) => ({
        url: server.url,
        name: server.name,
        // The host makes the first call itself, so a model-only tool is fine here.
        tools: server.tools.filter((tool) => toolUiResourceUri(tool)),
      }))
      .filter((server) => server.tools.length > 0),
  );
  const [pickedUrl, setServerUrl] = useState(initial?.serverUrl ?? "");
  // Servers with an app show up once their connection lists tools, which can be
  // after this form mounts, so fall back to the first one that is there.
  const serverUrl = servers.some((s) => s.url === pickedUrl)
    ? pickedUrl
    : (servers[0]?.url ?? "");
  const tools = servers.find((s) => s.url === serverUrl)?.tools ?? [];
  const [pickedTool, setToolName] = useState(initial?.toolName ?? "");
  const toolName = tools.some((t) => t.name === pickedTool)
    ? pickedTool
    : (defaultTool(tools)?.name ?? "");
  const [rawInput, setRawInput] = useState(
    JSON.stringify(initial?.toolInput ?? {}, null, 2),
  );
  const [inputError, setInputError] = useState<string | null>(null);

  const save = () => {
    let toolInput: Record<string, unknown>;
    try {
      const parsed = JSON.parse(rawInput || "{}");
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Arguments must be a JSON object");
      }
      toolInput = parsed;
    } catch (e) {
      setInputError(e instanceof Error ? e.message : "Invalid JSON");
      return;
    }
    setInputError(null);
    const picked = tools.find((t) => t.name === toolName);
    onSave({ serverUrl, toolName, toolInput }, picked ? toolTitle(picked) : toolName);
  };

  if (servers.length === 0) {
    return (
      <Notice>
        No connected MCP server offers a tool with an app. Add a server that supports
        MCP Apps in the MCP settings, then come back.
      </Notice>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3 text-sm">
      <label className="flex flex-col gap-1">
        MCP server
        <select
          className="rounded border p-1 dark:bg-dark-800"
          value={serverUrl}
          onChange={(e) => {
            setServerUrl(e.target.value);
            setToolName("");
          }}
        >
          {servers.map((s) => (
            <option key={s.url} value={s.url}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        Tool
        <select
          className="rounded border p-1 dark:bg-dark-800"
          value={toolName}
          onChange={(e) => setToolName(e.target.value)}
        >
          {tools.map((t) => (
            <option key={t.name} value={t.name}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        Arguments (JSON)
        <textarea
          className="min-h-24 rounded border p-1 font-mono dark:bg-dark-800"
          value={rawInput}
          onChange={(e) => setRawInput(e.target.value)}
        />
        {inputError && <span className="text-red-500">{inputError}</span>}
      </label>
      <div>
        <Button size="xs" variant="secondary" onClick={save}>
          Show app
        </Button>
      </div>
    </div>
  );
}

function AppView({
  config,
  onModelContext,
  refreshKey,
}: {
  config: McpAppConfig;
  onModelContext: (context: AppModelContext) => void;
  refreshKey: number;
}) {
  const theme = useShallowThemeStore((s) => s.theme);
  const { widget } = useWidgetContext();
  const server = useShallowMcpToolsStore((s) =>
    // An iframe widget can register a server at the same address; skip those.
    s.servers.find(
      (server) => server.url === config.serverUrl && !server.iframeWidgetId,
    ),
  );
  const tool = server?.tools.find((t) => t.name === config.toolName);
  const connectionState = useMcpToolsStore((s) =>
    server ? s.mcpConnectionRegistry[server.id]?.state : undefined,
  );
  const connectionError = useMcpToolsStore((s) =>
    server ? s.mcpConnectionRegistry[server.id]?.error : undefined,
  );
  const switchedOff = server?.enabled === false;
  const failed = connectionState === "failed";
  const disconnected = failed || switchedOff;
  const resourceUri = tool ? toolUiResourceUri(tool) : undefined;
  const autoRun = tool?.annotations?.readOnlyHint === true;
  const [approved, setApproved] = useState(false);
  const { pending, ask, answer, declineAll } = useCallConsent();
  const toolInputKey = JSON.stringify(config.toolInput);

  // Approval is for one run of one configuration: a refresh or a new tool asks again.
  useEffect(() => {
    setApproved(false);
  }, [config.toolName, config.serverUrl, toolInputKey, refreshKey]);

  // What this app told the chat ends with the app.
  useEffect(() => {
    const widgetId = widget.id;
    return () => useCopilotDataStore.getState().removeDataFromDashboardWidget(widgetId);
  }, [widget.id]);

  // Only a failed connection is retried on its own. A server the user switched
  // off stays off, for the Copilot too, until someone turns it on.
  const reconnectAttempts = useRef(0);
  useEffect(() => {
    if (connectionState === "ready") {
      reconnectAttempts.current = 0;
      return;
    }
    const delay = RECONNECT_DELAYS_MS[reconnectAttempts.current];
    if (!failed || switchedOff || delay === undefined) return;
    const timer = setTimeout(() => {
      reconnectAttempts.current += 1;
      connectionRef.current()?.retry?.();
    }, delay);
    return () => clearTimeout(timer);
  }, [connectionState, failed, switchedOff, server?.id]);

  const sandboxUrl = getConfig().mcpApps.sandboxUrl;
  const sandboxCheck = useMemo(
    () =>
      sandboxUrl
        ? checkSandboxOrigin(sandboxUrl, window.location.origin)
        : ({
            ok: false,
            reason: "MCP Apps are not set up: MCP_APPS_SANDBOX_URL is empty.",
          } as const),
    [sandboxUrl],
  );

  // Each server's apps run on an origin of their own when the sandbox address has a *.
  const serverUrl = server?.url;
  const [sandboxBase, setSandboxBase] = useState<string | null>(null);
  useEffect(() => {
    setSandboxBase(null);
    if (!sandboxCheck.ok || !serverUrl) return;
    let stale = false;
    sandboxIdFor(serverUrl)
      .then((id) => !stale && setSandboxBase(sandboxBaseFor(sandboxUrl, id)))
      .catch((e) => !stale && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      stale = true;
    };
  }, [sandboxUrl, sandboxCheck.ok, serverUrl]);

  const [resource, setResource] = useState<UiResource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // A callback ref: the box exists only once the app is shown, after the first render.
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const bridgeRef = useRef<AppBridge | null>(null);
  // The whole context, because AppBridge.setHostContext replaces what it holds
  // and a view that initializes again is given that.
  const hostContextRef = useRef<McpUiHostContext>({
    theme,
    displayMode: "inline",
    availableDisplayModes: ["inline"],
    platform: "web",
    locale: navigator.language,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    containerDimensions: { width: 0, height: 0 },
  });
  const updateHostContext = (change: McpUiHostContext) => {
    hostContextRef.current = { ...hostContextRef.current, ...change };
    bridgeRef.current?.setHostContext(hostContextRef.current);
  };
  const onModelContextRef = useRef(onModelContext);
  onModelContextRef.current = onModelContext;

  // Connection handlers must see the latest connection, not the one at mount.
  const connection = () =>
    server ? useMcpToolsStore.getState().mcpConnectionRegistry[server.id] : undefined;
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const toolsRef = useRef(server?.tools ?? []);
  toolsRef.current = server?.tools ?? [];

  // 1. Fetch the UI resource. A connection that drops and comes back keeps the view
  // it has, because reloading would restart the app, lose its filter and run its tool.
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    const loadKey = `${resourceUri}|${refreshKey}`;
    if (loadedFor.current === loadKey) return;
    loadedFor.current = null;
    setResource(null);
    setError(null);
    if (!resourceUri || connectionState !== "ready" || !sandboxCheck.ok) return;
    let stale = false;
    const read = connectionRef.current()?.readResource;
    if (!read) {
      setError("This connection cannot read resources.");
      return;
    }
    read(resourceUri)
      .then((result) => parseUiResource(result, resourceUri))
      .then((parsed) => {
        if (stale) return;
        loadedFor.current = loadKey;
        setResource(parsed);
      })
      .catch((e) => !stale && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      stale = true;
    };
  }, [resourceUri, connectionState, sandboxCheck.ok, refreshKey]);

  const frameSrc = useMemo(
    () =>
      resource && sandboxBase ? sandboxFrameUrl(sandboxBase, resource.csp) : undefined,
    [resource, sandboxBase],
  );
  const mayRun = autoRun || approved;

  // 2. Bridge between the sandboxed view and the MCP connection.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!resource || !frameSrc || !mayRun || !iframe?.contentWindow) return;

    const bridge = new AppBridge(
      null,
      HOST_INFO,
      {
        openLinks: {},
        serverTools: {},
        serverResources: {},
        logging: {},
        updateModelContext: { text: {}, structuredContent: {} },
        sandbox: { csp: resource.csp, permissions: resource.permissions },
      },
      { hostContext: hostContextRef.current },
    );
    bridgeRef.current = bridge;

    // Teardown can take a while; the bridge must not serve requests meanwhile,
    // or a re-run against the same iframe would answer every call twice.
    let disposed = false;
    // The view can send initialized more than once; the first tool runs once.
    let started = false;
    let appSentContext = false;
    const live = () => {
      if (disposed) throw refuse("This app is closing");
    };

    // Requests from the view. Nothing here talks to a server except through
    // Workspace's own connection.
    bridge.oncalltool = async (params) => {
      live();
      const target = toolsRef.current.find((t) => t.name === params.name);
      if (!appMayCallTool(target) || !target?.enabled) {
        throw refuse(`The tool ${params.name} may not be called by an app`);
      }
      if (appCallNeedsConsent(target)) {
        const allowed = await ask({
          toolName: target.name,
          title: toolTitle(target),
          args: params.arguments,
        });
        live();
        if (!allowed) throw refuse(`The user did not allow ${params.name} to run`);
      }
      const call = connectionRef.current()?.callTool;
      if (!call) throw refuse("The MCP connection is not ready");
      const result = await call(params.name, params.arguments);
      if (!result) throw refuse("The tool returned nothing");
      return result as CallToolResult;
    };
    bridge.onreadresource = async (params) => {
      live();
      const read = connectionRef.current()?.readResource;
      if (!read) throw refuse("The MCP connection is not ready");
      return read(params.uri);
    };
    bridge.onlistresources = async () => {
      live();
      return { resources: connectionRef.current()?.resources ?? [] };
    };
    bridge.onopenlink = async ({ url }) => {
      live();
      const safe = safeLink(url);
      if (!safe) throw refuse("Only http and https links can be opened");
      window.open(safe, "_blank", "noopener,noreferrer");
      return {};
    };
    bridge.onmessage = async () => {
      throw refuse("This dashboard has no chat to send messages to");
    };
    bridge.onupdatemodelcontext = async (params) => {
      live();
      appSentContext = true;
      onModelContextRef.current(params);
      return {};
    };
    bridge.onrequestdisplaymode = async () => ({ mode: "inline" });
    bridge.onloggingmessage = (params) => console.debug("[mcp-app]", params);

    bridge.onsandboxready = () => {
      void bridge.sendSandboxResourceReady({
        html: resource.html,
        sandbox: INNER_SANDBOX,
        csp: resource.csp,
        permissions: resource.permissions,
      });
    };
    bridge.oninitialized = async () => {
      if (disposed || started) return;
      started = true;
      try {
        await bridge.sendToolInput({ arguments: config.toolInput ?? {} });
        if (disposed) return;
        const call = connectionRef.current()?.callTool;
        if (!call) throw new Error("The MCP connection is not ready");
        const result = await call(config.toolName, config.toolInput);
        // A result that comes after the app closed is no longer what is on screen.
        if (disposed) return;
        if (!result) throw new Error("The tool returned nothing");
        // Until the app says what it shows, if it ever does.
        const seed = appSentContext
          ? null
          : contextFromToolResult(result as CallToolResult);
        if (seed) onModelContextRef.current(seed);
        await bridge.sendToolResult(result as CallToolResult);
      } catch (e) {
        if (disposed) return;
        const reason = e instanceof Error ? e.message : String(e);
        setError(reason);
        await bridge.sendToolCancelled({ reason }).catch(() => {});
      }
    };

    void bridge.connect(
      new PostMessageTransport(iframe.contentWindow, iframe.contentWindow),
    );

    return () => {
      disposed = true;
      declineAll();
      bridgeRef.current = null;
      void (async () => {
        try {
          await bridge.teardownResource({}, { timeout: TEARDOWN_TIMEOUT_MS });
        } catch {
          // the view did not answer in time; close anyway
        }
        await bridge.close().catch(() => {});
      })();
    };
  }, [
    resource,
    frameSrc,
    mayRun,
    config.toolName,
    config.serverUrl,
    JSON.stringify(config.toolInput),
  ]);

  // 3. Keep the view's context current.
  useEffect(() => {
    if (hostContextRef.current.theme !== theme) updateHostContext({ theme });
  }, [theme]);
  useEffect(() => {
    if (!box) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      updateHostContext({
        containerDimensions: { width: Math.round(width), height: Math.round(height) },
      });
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [box]);

  if (!sandboxCheck.ok) return <Notice tone="error">{sandboxCheck.reason}</Notice>;
  if (!server || !tool) {
    return (
      <Notice tone="error">
        The server or tool for this app is no longer available.
      </Notice>
    );
  }
  if (!resourceUri) {
    return <Notice tone="error">The tool {config.toolName} has no app.</Notice>;
  }
  const reconnectButton = switchedOff ? (
    <Button
      size="xs"
      variant="secondary"
      onClick={() =>
        useMcpToolsStore.getState().updateServer(server.id, { enabled: true })
      }
    >
      Turn on
    </Button>
  ) : (
    <Button
      size="xs"
      variant="secondary"
      onClick={() => {
        reconnectAttempts.current = 0;
        connectionRef.current()?.retry?.();
      }}
    >
      Retry
    </Button>
  );
  const disconnectedReason = switchedOff
    ? `${server.name} is switched off in the MCP settings`
    : `${server.name} is not connected${connectionError ? `: ${connectionError}` : ""}`;
  if (!resource || !frameSrc) {
    if (disconnected) {
      return (
        <Notice tone="error">
          {disconnectedReason}. {reconnectButton}
        </Notice>
      );
    }
    if (connectionState !== "ready") {
      return <Notice>Connecting to {server.name}…</Notice>;
    }
    if (error) return <Notice tone="error">{error}</Notice>;
    return <Notice>Loading app…</Notice>;
  }
  if (!mayRun) {
    return (
      <Notice>
        {runPrompt(tool)}{" "}
        <Button size="xs" variant="secondary" onClick={() => setApproved(true)}>
          Run
        </Button>
      </Notice>
    );
  }

  return (
    <div ref={setBox} className="relative h-full w-full">
      {sandboxCheck.warning && (
        <div className="absolute top-0 right-0 z-10 rounded-bl bg-yellow-500/20 px-2 text-xs">
          {sandboxCheck.warning}
        </div>
      )}
      {disconnected && (
        <div className="absolute bottom-0 left-0 z-10 flex items-center gap-2 rounded-tr bg-red-500/20 px-2 py-1 text-xs">
          {disconnectedReason}, so this view may be out of date. {reconnectButton}
        </div>
      )}
      <iframe
        ref={iframeRef}
        title={`${config.toolName} app`}
        src={frameSrc}
        sandbox={OUTER_SANDBOX}
        allow={buildAllowAttribute(resource.permissions)}
        className="h-full w-full border-0 bg-transparent"
      />
      {error && <Notice tone="error">{error}</Notice>}
      <ConfirmDialog
        open={pending !== null}
        onClose={() => answer(pending, false)}
        title={`Allow this app to run ${pending?.title ?? ""}?`}
        description="This tool does not say that it only reads, so it may change data. The app asked to run it with:"
        content={
          <pre className="max-h-64 overflow-auto rounded border p-2 font-mono text-xs dark:border-dark-600">
            {JSON.stringify(pending?.args ?? {}, null, 2)}
          </pre>
        }
        cancelText="Deny"
        confirmText="Allow once"
        onConfirm={() => answer(pending, true)}
      />
    </div>
  );
}

export default function McpAppWidget() {
  const { widget, updateWidget } = useWidgetContext();
  const config = widget?.storage?.mcpApp as McpAppConfig | undefined;
  const [editing, setEditing] = useState(!config);
  const [refreshKey, setRefreshKey] = useState(0);
  const { id: dashboardId = "" } = useParams();

  // Written straight to the store: a state update would commit too late for a
  // chat question asked right after the view changed.
  const publishContext = (params: AppModelContext) => {
    if (widget.disableRetrievalForCopilot) return;
    const context = contextFromApp(params);
    if (!context) return;
    const store = useCopilotDataStore.getState();
    const previous = store.dashboardWidgetsData[widget.id];
    // Tells the agent that the rows it kept for this chat are no longer what is
    // on screen. Unchanged rows keep their version, so its tables survive.
    const sameRows =
      previous && JSON.stringify(previous.data) === JSON.stringify(context.data);
    store.addDataOnDashboardWidget(widget.id, {
      data: context.data,
      title: widget.name,
      description: widget.description ?? "",
      innerTab: widget.innerTab,
      dashboardId,
      metadata: {
        data_version: sameRows ? previous.metadata?.data_version : Date.now(),
        lastUpdated: Date.now(),
        ...(context.summary ? { view_summary: context.summary } : {}),
      },
    });
  };

  return (
    <DraggableCard
      title={widget.name}
      showAIContextButton={false}
      extraNavbarElements={
        <div className="flex items-center gap-1">
          {config && !editing && (
            <Button
              size="xs"
              variant="secondary"
              onClick={() => setRefreshKey((k) => k + 1)}
            >
              Refresh
            </Button>
          )}
          <Button size="xs" variant="secondary" onClick={() => setEditing((e) => !e)}>
            {editing ? "Cancel" : "Settings"}
          </Button>
        </div>
      }
    >
      {editing || !config ? (
        <ConfigForm
          initial={config}
          onSave={(next, title) => {
            updateWidget((prev) => {
              const last = (prev.storage?.mcpApp as McpAppConfig | undefined)?.autoName;
              const name = widgetNameForTool(prev.name ?? "", last, title);
              return {
                ...prev,
                name,
                storage: {
                  ...prev.storage,
                  mcpApp: { ...next, autoName: name === title ? title : last },
                },
              };
            });
            useCopilotDataStore.getState().removeDataFromDashboardWidget(widget.id);
            setEditing(false);
          }}
        />
      ) : (
        <AppView
          config={config}
          refreshKey={refreshKey}
          onModelContext={publishContext}
        />
      )}
    </DraggableCard>
  );
}
