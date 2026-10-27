import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  SSEClientTransport,
  type SSEClientTransportOptions,
  SseError,
} from "@modelcontextprotocol/sdk/client/sse.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  FetchLike,
  Transport,
} from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolResultSchema,
  type GetPromptResult,
  GetPromptResultSchema,
  type JSONRPCMessage,
  ListPromptsResultSchema,
  ListResourcesResultSchema,
  ListToolsResultSchema,
  type Prompt,
  type ReadResourceResult,
  ReadResourceResultSchema,
  type Resource,
  type ResourceTemplate,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useStateReducer } from "~/hooks/useStateReducer";
import { mcpServersSaved, useMcpToolsStore } from "~/lib/state/mcpTools";
import { useThemeStore } from "~/lib/state/theme";
import { isLoopbackUrl } from "~/lib/utils/mcp";
import {
  createLocalMcpFetch,
  createMcpProxyFetch,
  deleteMcpOAuthGrant,
  getLocalMcpServerHeaders,
  MCP_AUTH_CHANNEL,
  type McpAuthCallbackMessage,
  McpAuthRequiredError,
  sameMcpServerUrl,
  startMcpOAuth,
} from "./mcpServerAuth";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const DEFAULT_RECONNECT_DELAY = 3000;
const DEFAULT_RETRY_DELAY = 5000;
export const MCP_AUTH_TIMEOUT_MS = 2 * 60 * 1000;
const TOOL_CALL_TIMEOUT = 5 * 60 * 1000;
const POPUP_FEATURES = "width=600,height=700,resizable=yes,scrollbars=yes,status=yes";

type TransportType = "http" | "sse";

type McpConnectionState =
  | "discovering"
  | "authenticating"
  | "connecting"
  | "loading"
  | "ready"
  | "failed";

type McpLogEntry = {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  timestamp: number;
};

export type UseMcpResult = {
  tools: Tool[];
  resources: Resource[];
  resourceTemplates: ResourceTemplate[];
  prompts: Prompt[];
  state: McpConnectionState;
  error?: string;
  log: McpLogEntry[];
  callTool: (name: string, args?: Record<string, unknown>) => Promise<unknown>;
  listResources: () => Promise<void>;
  readResource: (uri: string) => Promise<ReadResourceResult>;
  listPrompts: () => Promise<void>;
  getPrompt: (name: string, args?: Record<string, string>) => Promise<GetPromptResult>;
  retry: () => void;
  disconnect: () => void;
  clearStorage: () => void;
};

type MCPDataType = {
  state: McpConnectionState;
  tools: Tool[];
  resources: Resource[];
  resourceTemplates: ResourceTemplate[];
  prompts: Prompt[];
  error: string | undefined;
  log: McpLogEntry[];
};

export type UseMcpOptionsT = {
  url: string;
  serverId?: string;
  serverName?: string;
  clientName?: string;
  debug?: boolean;
  autoRetry?: boolean | number;
  autoReconnect?: boolean | number;
  transportType?: "auto" | "http" | "sse";
  handleDisconnect?: () => void;
  isLocal?: boolean;
  authType?: "oauth" | "token";
};

function getOptions(options: UseMcpOptionsT) {
  const newOptions: UseMcpOptionsT = {
    debug: false,
    autoRetry: false,
    autoReconnect: DEFAULT_RECONNECT_DELAY,
    transportType: "auto",
    ...options,
  };
  return newOptions;
}

function isAuthError(error: unknown, errorMessage?: string): boolean {
  if (!errorMessage)
    errorMessage = error instanceof Error ? error.message : String(error);

  return (
    error instanceof McpAuthRequiredError ||
    ((error instanceof StreamableHTTPError || error instanceof SseError) &&
      error.code === 401) ||
    errorMessage.includes("Unauthorized") ||
    errorMessage.includes("401")
  );
}

export function useMcp(options: UseMcpOptionsT): UseMcpResult {
  const {
    url,
    serverId,
    serverName,
    clientName,
    debug,
    autoRetry,
    autoReconnect,
    transportType,
    isLocal: isLocalOption,
    authType,
    handleDisconnect,
  } = useMemo(() => getOptions(options), [options]);

  const isLocal = isLocalOption || isLoopbackUrl(url);
  const usesTokenAuth = authType === "token";

  const [data, dispatch] = useStateReducer<MCPDataType>({
    state: "discovering",
    tools: [],
    resources: [],
    resourceTemplates: [],
    prompts: [],
    log: [],
    error: undefined,
  });

  const clientRef = useRef<Client | null>(null);
  const transportRef = useRef<Transport | null>(null);
  const connectingRef = useRef<boolean>(false);
  const isMountedRef = useRef<boolean>(true);
  const connectAttemptRef = useRef<number>(0);
  const authTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const stateRef = useRef(data.state);
  const isAuthenticating = () => stateRef.current === "authenticating";
  const autoReconnectRef = useRef(autoReconnect);
  const successfulTransportRef = useRef<TransportType | null>(null);

  useEffect(() => {
    stateRef.current = data.state;
    autoReconnectRef.current = autoReconnect;
  }, [data.state, autoReconnect]);

  const addLog = useCallback(
    (level: McpLogEntry["level"], message: string, ...args: unknown[]) => {
      if (!debug) return;
      const fullMessage =
        args.length > 0
          ? `${message} ${args.map((arg) => JSON.stringify(arg)).join(" ")}`
          : message;
      console[level](`[useMcp] ${fullMessage}`);
      if (isMountedRef.current) {
        dispatch({
          log: (prevLog) => [
            ...prevLog.slice(-100),
            { level, message: fullMessage, timestamp: Date.now() },
          ],
        });
      }
    },
    [isMountedRef, debug],
  );

  const disconnect = useCallback(
    async (quiet = false) => {
      if (!quiet) addLog("info", "Disconnecting...");
      connectingRef.current = false;
      if (authTimeoutRef.current) clearTimeout(authTimeoutRef.current);
      authTimeoutRef.current = null;

      const transport = transportRef.current;
      clientRef.current = null;
      transportRef.current = null;

      if (isMountedRef.current && !quiet) {
        dispatch({
          state: "discovering",
          tools: [],
          resources: [],
          resourceTemplates: [],
          prompts: [],
          error: undefined,
        });
      }

      if (transport) {
        try {
          await transport.close();
          if (!quiet) addLog("debug", "Transport closed");
        } catch (err) {
          if (!quiet) addLog("warn", "Error closing transport:", err);
        }
      }
    },
    [addLog, connectingRef, authTimeoutRef, isMountedRef, transportRef, clientRef],
  );

  const failConnection = useCallback(
    (errorMessage: string, connectionError?: Error) => {
      addLog("error", errorMessage, connectionError ?? "");
      if (isMountedRef.current) dispatch({ state: "failed", error: errorMessage });
      connectingRef.current = false;
    },
    [addLog, isMountedRef, connectingRef],
  );

  const handleAuthTimeout = useCallback(() => {
    failConnection("Authentication timed out. Please try again.");
    if (serverId) {
      useMcpToolsStore.getState().disableServerAfterAuthCancel(serverId);
    }
    if (useThemeStore.getState().mcpAuthPopup?.url === url) {
      useThemeStore.getState().setMcpAuthPopup(null);
    }
  }, [failConnection, serverId, url]);

  const handleAuthRequired = useCallback(
    async (error: Error) => {
      if (usesTokenAuth) {
        failConnection(
          `Couldn't authenticate with ${serverName || "the MCP server"}. Check that your token is valid and not expired.`,
          error,
        );
        return false;
      }
      if (isLocal) {
        failConnection(
          `Couldn't authenticate with ${serverName || "the MCP server"}. Check the headers saved for this local server.`,
          error,
        );
        return false;
      }
      if (stateRef.current === "authenticating") return true;

      dispatch({ state: "authenticating" });
      if (authTimeoutRef.current) clearTimeout(authTimeoutRef.current);
      authTimeoutRef.current = setTimeout(handleAuthTimeout, MCP_AUTH_TIMEOUT_MS);
      try {
        const authUrl = await startMcpOAuth(url);
        if (!isMountedRef.current) return false;
        addLog("info", "Asking the user to sign in. Waiting for the callback...");
        const left = window.screenX + (window.innerWidth - 600) / 2;
        const top = window.screenY + (window.innerHeight - 600) / 2;
        useThemeStore.getState().setMcpAuthPopup({
          serverName,
          url,
          authUrl,
          popupFeatures: `${POPUP_FEATURES},left=${left},top=${top}`,
        });
        return true;
      } catch (startError) {
        if (authTimeoutRef.current) clearTimeout(authTimeoutRef.current);
        failConnection(
          `Failed to initiate authentication: ${startError instanceof Error ? startError.message : String(startError)}`,
          startError instanceof Error ? startError : undefined,
        );
        return false;
      }
    },
    [
      url,
      usesTokenAuth,
      isLocal,
      serverName,
      addLog,
      failConnection,
      handleAuthTimeout,
    ],
  );

  const createFetch = useCallback(async (): Promise<FetchLike> => {
    if (!isLocal) return createMcpProxyFetch(url);
    const server = useMcpToolsStore.getState().servers.find((s) => s.id === serverId);
    const headers = server?.customHeaderNames?.length
      ? await getLocalMcpServerHeaders(url)
      : {};
    return createLocalMcpFetch(headers);
  }, [url, isLocal, serverId]);

  const connect = useCallback(async () => {
    if (connectingRef.current) {
      addLog("debug", "Connection attempt already in progress.");
      return;
    }
    if (!isMountedRef.current) {
      addLog("debug", "Connect called after unmount, aborting.");
      return;
    }

    connectingRef.current = true;
    connectAttemptRef.current += 1;
    successfulTransportRef.current = null;
    dispatch({ state: "discovering", error: undefined });
    addLog("info", `Connecting attempt #${connectAttemptRef.current} to ${url}...`);

    let fetchFn: FetchLike;
    try {
      await mcpServersSaved();
      fetchFn = await createFetch();
    } catch (err) {
      failConnection(
        `Failed to prepare the connection: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
      return;
    }
    if (!isMountedRef.current) {
      connectingRef.current = false;
      return;
    }

    if (!clientRef.current) {
      clientRef.current = new Client(
        { name: clientName || "Workspace", version: "0.1.0" },
        { capabilities: {} },
      );
      addLog("debug", "MCP Client initialized in connect.");
    }

    const tryConnectWithTransport = async (
      transportType: TransportType,
    ): Promise<"success" | "fallback" | "auth_required" | "failed"> => {
      addLog(
        "info",
        `Attempting connection with ${transportType.toUpperCase()} transport...`,
      );
      if (stateRef.current !== "authenticating") {
        dispatch({ state: "connecting" });
      }

      let transportInstance: Transport;

      try {
        assert(clientRef.current, "Client must be initialized");

        if (transportRef.current) {
          await transportRef.current
            .close()
            .catch((e) =>
              addLog("warn", `Error closing previous transport: ${e.message}`),
            );
          transportRef.current = null;
        }

        const commonOptions: SSEClientTransportOptions = {
          requestInit: { headers: { accept: "application/json, text/event-stream" } },
          fetch: fetchFn,
        };
        const targetUrl = new URL(url);

        addLog(
          "debug",
          `Creating ${transportType.toUpperCase()} transport for URL: ${targetUrl.toString()}`,
        );

        if (transportType === "http") {
          transportInstance = new StreamableHTTPClientTransport(
            targetUrl,
            commonOptions,
          );
        } else {
          transportInstance = new SSEClientTransport(targetUrl, commonOptions);
        }
        transportRef.current = transportInstance;
        addLog(
          "debug",
          `${transportType.toUpperCase()} transport created and assigned to ref.`,
        );
      } catch (err) {
        failConnection(
          `Failed to create ${transportType.toUpperCase()} transport: ${err instanceof Error ? err.message : String(err)}`,
          err instanceof Error ? err : undefined,
        );
        return "failed";
      }

      transportInstance.onmessage = (message: JSONRPCMessage) => {
        addLog("debug", `[Transport] Received: ${JSON.stringify(message)}`);
      };
      transportInstance.onerror = (err: Error) => {
        addLog("warn", `Transport error event (${transportType.toUpperCase()}):`, err);
        if (isAuthError(err)) return;
        if (!(err instanceof StreamableHTTPError && err.code === 504))
          failConnection(
            `Transport error (${transportType.toUpperCase()}): ${err.message}`,
            err,
          );
      };
      transportInstance.onclose = () => {
        if (!isMountedRef.current || connectingRef.current) return;

        addLog(
          "info",
          `Transport connection closed (${successfulTransportRef.current || "unknown"} type).`,
        );
        const currentState = stateRef.current;
        const currentAutoReconnect = autoReconnectRef.current;

        if (currentState === "ready" && currentAutoReconnect) {
          const delay =
            typeof currentAutoReconnect === "number"
              ? currentAutoReconnect
              : DEFAULT_RECONNECT_DELAY;
          addLog("info", `Attempting to reconnect in ${delay}ms...`);
          dispatch({ state: "connecting" });
          setTimeout(() => {
            if (isMountedRef.current) {
              connect();
            }
          }, delay);
        } else if (currentState !== "failed" && currentState !== "authenticating") {
          failConnection("Connection closed unexpectedly.");
        }
      };

      try {
        addLog("info", `Connecting client via ${transportType.toUpperCase()}...`);

        const client = clientRef.current;
        assert(client, "Client must be initialized");
        await client.connect(transportInstance);

        addLog(
          "info",
          `Client connected via ${transportType.toUpperCase()}. Loading tools, resources, and prompts...`,
        );
        successfulTransportRef.current = transportType;

        let resourcesResponse: {
          resources: Resource[];
          resourceTemplates?: ResourceTemplate[];
        } = { resources: [], resourceTemplates: [] };
        try {
          resourcesResponse = (await client.request(
            { method: "resources/list" },
            ListResourcesResultSchema,
          )) as { resources: Resource[]; resourceTemplates?: ResourceTemplate[] };
        } catch (err) {
          if (isAuthError(err)) throw err;
          addLog("debug", "Server does not support resources/list method", err);
        }

        dispatch({ state: "loading" });
        const toolsResponse = await client.request(
          { method: "tools/list" },
          ListToolsResultSchema,
        );

        let promptsResponse: { prompts: Prompt[] } = { prompts: [] };
        try {
          promptsResponse = (await client.request(
            { method: "prompts/list" },
            ListPromptsResultSchema,
          )) as { prompts: Prompt[] };
        } catch (err) {
          if (isAuthError(err)) throw err;
          addLog("debug", "Server does not support prompts/list method", err);
        }

        if (isMountedRef.current) {
          dispatch({
            tools: toolsResponse.tools,
            resources: resourcesResponse.resources,
            resourceTemplates: Array.isArray(resourcesResponse.resourceTemplates)
              ? resourcesResponse.resourceTemplates
              : [],
            prompts: promptsResponse.prompts,
          });

          const summary = [`Loaded ${toolsResponse.tools.length} tools`];
          if (
            resourcesResponse.resources.length > 0 ||
            (resourcesResponse.resourceTemplates &&
              resourcesResponse.resourceTemplates.length > 0)
          ) {
            summary.push(`${resourcesResponse.resources.length} resources`);
            if (
              Array.isArray(resourcesResponse.resourceTemplates) &&
              resourcesResponse.resourceTemplates.length > 0
            ) {
              summary.push(
                `${resourcesResponse.resourceTemplates.length} resource templates`,
              );
            }
          }
          if (promptsResponse.prompts.length > 0) {
            summary.push(`${promptsResponse.prompts.length} prompts`);
          }

          addLog("info", `${summary.join(", ")}.`);
          dispatch({ state: "ready" });
          connectAttemptRef.current = 0;
          return "success";
        }
        return "failed";
      } catch (connectErr) {
        addLog(
          "debug",
          `Client connect error via ${transportType.toUpperCase()}:`,
          connectErr,
        );
        const errorInstance =
          connectErr instanceof Error ? connectErr : new Error(String(connectErr));

        const errorMessage = errorInstance.message;
        const is404 =
          errorMessage.includes("404") || errorMessage.includes("Not Found");
        const is405 =
          errorMessage.includes("405") || errorMessage.includes("Method Not Allowed");
        const isLikelyCors =
          errorMessage === "Failed to fetch" ||
          errorMessage === "NetworkError when attempting to fetch resource." ||
          errorMessage === "Load failed";

        if (transportType === "http" && (is404 || is405 || isLikelyCors)) {
          addLog(
            "warn",
            `HTTP transport failed (${isLikelyCors ? "CORS" : is404 ? "404" : "405"}).`,
          );
          return "fallback";
        }

        if (isAuthError(errorInstance, errorMessage)) {
          addLog("info", "Authentication required.");
          return (await handleAuthRequired(errorInstance)) ? "auth_required" : "failed";
        }

        failConnection(
          `Failed to connect via ${transportType.toUpperCase()}: ${errorMessage}`,
          errorInstance,
        );
        return "failed";
      }
    };

    let finalStatus: "success" | "auth_required" | "failed" | "fallback";

    if (transportType === "sse") {
      addLog("debug", "Using SSE-only transport mode");
      finalStatus = await tryConnectWithTransport("sse");
    } else if (transportType === "http") {
      addLog("debug", "Using HTTP-only transport mode");
      finalStatus = await tryConnectWithTransport("http");
    } else {
      addLog("debug", "Using auto transport mode (HTTP with SSE fallback)");
      finalStatus = await tryConnectWithTransport("http");

      if (finalStatus === "fallback" && isMountedRef.current) {
        addLog("info", "HTTP failed, attempting SSE fallback...");
        finalStatus = await tryConnectWithTransport("sse");
      }
    }

    connectingRef.current = false;
    if (finalStatus === "failed" && isMountedRef.current) handleDisconnect?.();
    addLog("debug", `Connection sequence finished with status: ${finalStatus}`);
  }, [
    addLog,
    failConnection,
    handleAuthRequired,
    handleDisconnect,
    createFetch,
    url,
    clientName,
    transportType,

    stateRef,
    clientRef,
    transportRef,
    connectingRef,
    connectAttemptRef,
    isMountedRef,
    successfulTransportRef,
    autoReconnectRef,
  ]);

  const callTool = useCallback(
    async (name: string, args?: Record<string, unknown>) => {
      const state = data.state;
      if (stateRef.current !== "ready" || !clientRef.current) {
        throw new Error(
          `MCP client is not ready (current state: ${state}). Cannot call tool "${name}".`,
        );
      }
      addLog("info", `Calling tool: ${name}`, args);
      try {
        const result = await clientRef.current.request(
          { method: "tools/call", params: { name, arguments: args } },
          CallToolResultSchema,
          { timeout: TOOL_CALL_TIMEOUT },
        );
        addLog("info", `Tool "${name}" call successful:`, result);
        return result;
      } catch (err) {
        addLog(
          "error",
          `Error calling tool "${name}": ${err instanceof Error ? err.message : String(err)}`,
          err,
        );
        const errorInstance = err instanceof Error ? err : new Error(String(err));

        if (isAuthError(errorInstance)) {
          addLog("warn", "Tool call unauthorized, signing in again...");
          await handleAuthRequired(errorInstance);
        }
        if (!isAuthenticating()) throw err;
        return undefined;
      }
    },
    [data.state, addLog, handleAuthRequired, stateRef, clientRef],
  );

  const retry = useCallback(() => {
    if (connectingRef.current) {
      addLog("warn", "Retry called while connecting. Ignoring.");
      return;
    }
    addLog("info", "Retry requested...");
    connect();
  }, [addLog, connect, connectingRef]);

  const clearStorage = useCallback(() => {
    deleteMcpOAuthGrant(url).catch((error) =>
      addLog("warn", `Failed to forget the sign-in for ${url}:`, error),
    );
    disconnect();
  }, [url, addLog, disconnect]);

  const listResources = useCallback(async () => {
    const state = data.state;
    if (stateRef.current !== "ready" || !clientRef.current) {
      throw new Error(
        `MCP client is not ready (current state: ${state}). Cannot list resources.`,
      );
    }
    addLog("info", "Listing resources...");
    try {
      const resourcesResponse = await clientRef.current.request(
        { method: "resources/list" },
        ListResourcesResultSchema,
      );
      if (isMountedRef.current) {
        dispatch({
          resources: resourcesResponse.resources,
          resourceTemplates: Array.isArray(resourcesResponse.resourceTemplates)
            ? resourcesResponse.resourceTemplates
            : [],
        });
        addLog(
          "info",
          `Listed ${resourcesResponse.resources.length} resources, ${Array.isArray(resourcesResponse.resourceTemplates) ? resourcesResponse.resourceTemplates.length : 0} resource templates.`,
        );
      }
    } catch (err) {
      addLog(
        "error",
        `Error listing resources: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
      throw err;
    }
  }, [data.state, addLog]);

  const readResource = useCallback(
    async (uri: string) => {
      const state = data.state;
      if (stateRef.current !== "ready" || !clientRef.current) {
        throw new Error(
          `MCP client is not ready (current state: ${state}). Cannot read resource "${uri}".`,
        );
      }
      addLog("info", `Reading resource: ${uri}`);
      try {
        const result = await clientRef.current.request(
          { method: "resources/read", params: { uri } },
          ReadResourceResultSchema,
        );
        addLog("info", `Resource "${uri}" read successfully`);
        return result;
      } catch (err) {
        addLog(
          "error",
          `Error reading resource "${uri}": ${err instanceof Error ? err.message : String(err)}`,
          err,
        );
        throw err;
      }
    },
    [data.state, addLog, stateRef, clientRef],
  );

  const listPrompts = useCallback(async () => {
    const state = data.state;
    if (stateRef.current !== "ready" || !clientRef.current) {
      throw new Error(
        `MCP client is not ready (current state: ${state}). Cannot list prompts.`,
      );
    }
    addLog("info", "Listing prompts...");
    try {
      const promptsResponse = await clientRef.current.request(
        { method: "prompts/list" },
        ListPromptsResultSchema,
      );
      if (isMountedRef.current) {
        dispatch({ prompts: promptsResponse.prompts });
        addLog("info", `Listed ${promptsResponse.prompts.length} prompts.`);
      }
    } catch (err) {
      addLog(
        "error",
        `Error listing prompts: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
      throw err;
    }
  }, [data.state, addLog, stateRef, isMountedRef, clientRef]);

  const getPrompt = useCallback(
    async (name: string, args?: Record<string, string>) => {
      const state = data.state;
      if (stateRef.current !== "ready" || !clientRef.current) {
        throw new Error(
          `MCP client is not ready (current state: ${state}). Cannot get prompt "${name}".`,
        );
      }
      addLog("info", `Getting prompt: ${name}`, args);
      try {
        const result = await clientRef.current.request(
          { method: "prompts/get", params: { name, arguments: args } },
          GetPromptResultSchema,
        );
        addLog("info", `Prompt "${name}" retrieved successfully`);
        return result;
      } catch (err) {
        addLog(
          "error",
          `Error getting prompt "${name}": ${err instanceof Error ? err.message : String(err)}`,
          err,
        );
        throw err;
      }
    },
    [data.state, addLog, clientRef, stateRef],
  );

  useEffect(() => {
    const channel = new BroadcastChannel(MCP_AUTH_CHANNEL);
    const messageHandler = (event: MessageEvent<McpAuthCallbackMessage>) => {
      if (event.origin && event.origin !== window.location.origin) return;
      if (event.data?.type !== "mcp_auth_callback") return;
      if (stateRef.current !== "authenticating") return;

      if (event.data.success) {
        const { serverUrl } = event.data;
        if (serverUrl && !sameMcpServerUrl(serverUrl, url)) return;
        addLog("info", "Authentication successful via popup. Reconnecting client...");
        if (authTimeoutRef.current) clearTimeout(authTimeoutRef.current);
        if (useThemeStore.getState().mcpAuthPopup?.url === url) {
          useThemeStore.getState().setMcpAuthPopup(null);
        }
        connect();
      } else {
        if (authTimeoutRef.current) clearTimeout(authTimeoutRef.current);
        failConnection(`Authentication failed in callback: ${event.data.error}`);
      }
    };
    channel.addEventListener("message", messageHandler);
    return () => {
      channel.removeEventListener("message", messageHandler);
      channel.close();
      if (authTimeoutRef.current) clearTimeout(authTimeoutRef.current);
    };
  }, [url, addLog, failConnection, connect]);

  useEffect(() => {
    isMountedRef.current = true;
    addLog("debug", "useMcp mounted, initiating connection.");
    connectAttemptRef.current = 0;
    connect();
    return () => {
      isMountedRef.current = false;
      addLog("debug", "useMcp unmounting, disconnecting.");
      disconnect(true);
    };
  }, [url, connect, disconnect, isMountedRef, connectAttemptRef]);

  useEffect(() => {
    let retryTimeoutId: NodeJS.Timeout | null = null;
    if (data.state === "failed" && autoRetry && connectAttemptRef.current > 0) {
      const delay = typeof autoRetry === "number" ? autoRetry : DEFAULT_RETRY_DELAY;
      addLog("info", `Connection failed, auto-retrying in ${delay}ms...`);
      retryTimeoutId = setTimeout(() => {
        if (isMountedRef.current && stateRef.current === "failed") {
          retry();
        }
      }, delay);
    }
    return () => {
      if (retryTimeoutId) clearTimeout(retryTimeoutId);
    };
  }, [data.state === "failed", autoRetry, retry, addLog]);

  return {
    state: data.state,
    tools: data.tools,
    resources: data.resources,
    resourceTemplates: data.resourceTemplates,
    prompts: data.prompts,
    error: data.error,
    log: data.log,
    callTool,
    listResources,
    readResource,
    listPrompts,
    getPrompt,
    retry,
    disconnect,
    clearStorage,
  };
}
