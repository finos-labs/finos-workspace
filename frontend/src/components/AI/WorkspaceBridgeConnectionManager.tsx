import { memo, useCallback, useEffect, useReducer, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { startBridgeSession } from "~/api/workspaceBridge.api";
import { useActiveWorkspaceDashboardId } from "~/components/AI/hooks/useActiveWorkspaceDashboardId";
import { useSyncWidgetsInCurrentDashboard } from "~/components/AI/hooks/useWidgetsInCurrentDashboard";
import { useWorkspaceBridgeCommandHandler } from "~/components/AI/hooks/useWorkspaceBridgeCommandHandler";
import {
  BRIDGE_LIMITS,
  type BrowserSessionContext,
  type ClientEvent,
  type ServerEvent,
} from "~/components/AI/workspaceBridgeProtocol";
import { useShallowAppStore } from "~/lib/state/app";
import {
  useShallowWorkspaceBridgeStore,
  useWorkspaceBridgeStore,
} from "~/lib/state/workspaceBridge";

const {
  reconnectBaseDelayMs: RECONNECT_BASE_DELAY_MS,
  maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS,
  sessionStartTimeoutMs: SESSION_START_TIMEOUT_MS,
  heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
  heartbeatTimeoutMs: HEARTBEAT_TIMEOUT_MS,
} = BRIDGE_LIMITS;
const RECONNECT_TOAST_ID = "workspace-bridge-reconnecting";

function getReconnectDelayMs(attempt: number) {
  return RECONNECT_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1);
}

function formatReconnectDelay(delayMs: number) {
  const seconds = delayMs / 1000;
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

const dismissReconnectToast = () => toast.dismiss(RECONNECT_TOAST_ID);

function areSessionContextsEqual(
  left: BrowserSessionContext,
  right: BrowserSessionContext,
) {
  return (
    (left.current_dashboard_id ?? null) === (right.current_dashboard_id ?? null) &&
    (left.current_tab_id ?? null) === (right.current_tab_id ?? null)
  );
}

const WorkspaceBridgeConnection = memo(() => {
  const currentDashboardId = useActiveWorkspaceDashboardId();
  const [searchParams] = useSearchParams();
  useSyncWidgetsInCurrentDashboard();
  const lastInnerTab = useShallowAppStore((state) =>
    currentDashboardId ? state.getLastInnerTab(currentDashboardId) || "" : "",
  );
  const currentTabId = searchParams.get("tab") || lastInnerTab || "";

  const status = useShallowWorkspaceBridgeStore((state) => state.status);

  const socketRef = useRef<WebSocketBridge | null>(null);
  const [reconnectTick, bumpReconnectTick] = useReducer(
    (value: number) => value + 1,
    0,
  );

  const handleCommand = useWorkspaceBridgeCommandHandler();
  const handleCommandRef = useRef(handleCommand);
  useEffect(() => {
    handleCommandRef.current = handleCommand;
  }, [handleCommand]);

  const onCommandRequest = useCallback(
    async (event: ServerEvent, socket: WebSocketBridge) => {
      if (event.type !== "command_request") return;

      const result = await handleCommandRef.current(event.command);
      socket.send({ type: "command_result", result });
    },
    [handleCommandRef],
  );

  const closeSocket = useCallback(() => {
    const socket = socketRef.current;
    socketRef.current = null;
    dismissReconnectToast();

    socket?.close();
  }, [socketRef]);

  const connectSocket = useCallback(
    (websocketUrl: string) => {
      const client = socketRef.current;
      if (!client) return;

      if (client.connected && client.connectionUrl === websocketUrl) {
        client.abort();
        socketRef.current = client.init(onCommandRequest);
        return;
      }

      socketRef.current = client.setWsUrl(websocketUrl).init(onCommandRequest);
    },
    [socketRef, onCommandRequest],
  );

  useEffect(() => {
    if (status !== "attempting" && status !== "reconnecting") return;
    if (!socketRef.current) socketRef.current = new WebSocketBridge();
    socketRef.current = socketRef.current.setBumpReconnectTick(bumpReconnectTick);

    const abortController = new AbortController();

    const connect = async () => {
      try {
        if (socketRef.current?.connected) return;
        const payload = await startBridgeSession(
          {
            client_name: "workspace-ui",
            current_dashboard_id: currentDashboardId || null,
            current_tab_id: currentTabId || null,
          },
          AbortSignal.any([
            abortController.signal,
            AbortSignal.timeout(SESSION_START_TIMEOUT_MS),
          ]),
        );
        if (abortController.signal.aborted) return;

        connectSocket(payload.websocket_url);
      } catch (error) {
        if (abortController.signal.aborted) return;
        socketRef.current?.queueReconnect(
          error instanceof Error
            ? error.message
            : "Could not connect to the hosted Workspace MCP bridge.",
        );
      }
    };

    const timeoutId = window.setTimeout(
      () => void connect(),
      status === "reconnecting"
        ? getReconnectDelayMs(socketRef.current?.reconnectAttempts)
        : 0,
    );

    return () => {
      abortController.abort();
      window.clearTimeout(timeoutId);
    };
  }, [reconnectTick, status, currentDashboardId, currentTabId, connectSocket]);

  useEffect(() => {
    const { status: mountStatus, updateStatus } = useWorkspaceBridgeStore.getState();
    if (mountStatus === "connected") updateStatus("attempting");
    return () => closeSocket();
  }, []);

  useEffect(() => {
    if (status !== "connected") return;
    socketRef.current?.sendSessionContext({
      current_dashboard_id: currentDashboardId || null,
      current_tab_id: currentTabId || null,
    });
  }, [socketRef, currentDashboardId, currentTabId]);

  return null;
});

export const WorkspaceBridgeConnectionManager = memo(() => {
  const isEnabled = useShallowWorkspaceBridgeStore((state) => state.isEnabled);

  if (!isEnabled) return null;
  return <WorkspaceBridgeConnection />;
});
WorkspaceBridgeConnectionManager.displayName = "WorkspaceBridgeConnectionManager";

class WebSocketBridge {
  _ws: WebSocket | null = null;
  _connectionString: string | URL | undefined;

  _abortController: AbortController | null = null;
  _lastSentSessionContext: BrowserSessionContext = {
    current_dashboard_id: null,
    current_tab_id: null,
  };
  _lastPong = 0;
  _reconnectQueued = false;
  _reconnectAttempts = 0;
  _supportsSessionContext = false;
  _pingIntervalId: number | null = null;
  _bumpReconnectTick: () => void = () => {};

  constructor(_connectionString?: string | URL) {
    this._connectionString = _connectionString;
  }

  setBumpReconnectTick(bump: () => void) {
    this._bumpReconnectTick = bump;
    this._reconnectQueued = false;
    return this;
  }

  setWsUrl(url: string | URL) {
    this._connectionString = url;
    return this;
  }

  get ws(): WebSocket | null {
    return this._ws;
  }

  get connectionUrl(): string | URL | undefined {
    return this._connectionString;
  }

  get reconnectAttempts(): number {
    return this._reconnectAttempts;
  }

  get connected(): boolean {
    return this._ws?.readyState === WebSocket.OPEN;
  }

  get connecting(): boolean {
    return this._ws?.readyState === WebSocket.CONNECTING;
  }

  get closed(): boolean {
    return this._ws?.readyState === WebSocket.CLOSED;
  }

  get disconnecting(): boolean {
    return this._abortController?.signal?.aborted ?? false;
  }

  setReconnectAttempts(value: number) {
    this._reconnectAttempts = value;
    this._reconnectQueued = value > 0;
    if (value === 0) this._lastPong = Date.now();
  }

  init(onCommandRequest: (msg: ServerEvent, socket: this) => void) {
    if (!this._connectionString) return this;

    const existing = this._ws;
    const reusable =
      existing !== null &&
      existing.url === this._connectionString &&
      (this.connected || this.connecting);

    let ws: WebSocket;
    if (existing && reusable) {
      ws = existing;
    } else {
      if (existing) {
        existing.onopen = null;
        existing.onclose = null;
        existing.onerror = null;
        this.abort();
        existing.close();
      }
      this._abortController = new AbortController();
      ws = new WebSocket(this._connectionString);
      this._ws = ws;
    }
    if (this._abortController?.signal?.aborted) {
      this._abortController = new AbortController();
    }

    ws.onopen = () => {
      this.setReconnectAttempts(0);
      this.pingTimeout();
    };

    ws.onclose = () => {
      if (this.disconnecting) return;
      this.queueReconnect("Workspace MCP bridge connection closed.");
    };

    ws.onerror = () => {
      if (this.disconnecting) return;
      this.queueReconnect("Workspace MCP bridge connection error.");
    };

    this.onMessageSync(onCommandRequest);

    return this;
  }

  abort() {
    this._abortController?.abort?.();
  }

  bumpReconnectTick() {
    this._bumpReconnectTick();
  }

  queueReconnect(message: string) {
    const store = useWorkspaceBridgeStore.getState();
    if (!store.isEnabled || this.disconnecting || this._reconnectQueued) return;

    const nextAttempt = this._reconnectAttempts + 1;
    if (nextAttempt > MAX_RECONNECT_ATTEMPTS) {
      dismissReconnectToast();
      const finalMessage = `Workspace MCP bridge connection lost. Failed to reconnect after ${MAX_RECONNECT_ATTEMPTS} attempts.`;
      store.updateStatus("failed", finalMessage);
      toast.error("Workspace MCP companion disconnected", {
        description: finalMessage,
      });
      return;
    }

    this.setReconnectAttempts(nextAttempt);
    store.updateStatus("reconnecting", message);
    this.bumpReconnectTick();

    if (!store.isModalOpen) return;

    const delayMs = getReconnectDelayMs(nextAttempt);
    toast.warning("Workspace MCP companion reconnecting", {
      id: RECONNECT_TOAST_ID,
      duration: Number.POSITIVE_INFINITY,
      description: `${message} Retrying in ${formatReconnectDelay(delayMs)} (attempt ${nextAttempt} of ${MAX_RECONNECT_ATTEMPTS}).`,
    });
  }

  onMessageSync(onCommandRequest: (msg: ServerEvent, socket: this) => void): void {
    this._ws?.addEventListener(
      "message",
      (e) => {
        try {
          const event = JSON.parse(e.data) as ServerEvent;
          switch (event.type) {
            case "session_ready":
              this._reconnectAttempts = 0;
              this._reconnectQueued = false;
              this._supportsSessionContext =
                "current_dashboard_id" in event.session ||
                "current_tab_id" in event.session;
              this._lastSentSessionContext = {
                current_dashboard_id: event.session.current_dashboard_id ?? null,
                current_tab_id: event.session.current_tab_id ?? null,
              };
              dismissReconnectToast();
              this.updateStatus("connected");
              return;
            case "command_request":
              return onCommandRequest?.(event, this);
            case "pong":
              this._lastPong = Date.now();
              return;
            case "error":
              dismissReconnectToast();
              this.updateStatus(
                "failed",
                event.error?.message || "Workspace MCP bridge returned an error.",
              );
              return;
          }
        } catch {
          console.error("websocket error: invalid payload");
          dismissReconnectToast();
          this.updateStatus(
            "failed",
            "Workspace MCP bridge sent an invalid websocket payload.",
          );
        }
      },
      { signal: this._abortController?.signal },
    );
  }

  updateStatus(status: "failed" | "connected" | "reconnecting", message?: string) {
    useWorkspaceBridgeStore.getState().updateStatus(status, message);
  }

  send(msg: string | ClientEvent) {
    if (!this.connected) return;
    if (typeof msg !== "string") msg = JSON.stringify(msg);
    this._ws?.send(msg);
  }

  sendSessionContext(session: BrowserSessionContext) {
    if (!this._supportsSessionContext) return;
    if (areSessionContextsEqual(this._lastSentSessionContext, session)) return;

    this._lastSentSessionContext = session;
    this.send({ type: "session_context_changed", session });
  }

  pingTimeout() {
    if (this._pingIntervalId) window.clearInterval(this._pingIntervalId);
    if (!this.connected) return;

    this._lastPong = Date.now();
    this._pingIntervalId = window.setInterval(() => {
      if (!this.connected) return;

      if (Date.now() - this._lastPong > HEARTBEAT_TIMEOUT_MS) {
        this.close(true);
        return;
      }

      this.send({ type: "ping" });
    }, HEARTBEAT_INTERVAL_MS);
  }

  close(reconnect = false) {
    if (this._pingIntervalId) window.clearInterval(this._pingIntervalId);
    this._pingIntervalId = null;
    if (!reconnect) {
      this.abort();
    }
    this._ws?.close();
    this._ws = null;
  }
}
