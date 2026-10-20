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

/**
 * Asserts that a condition is true, throwing an error if not.
 * Useful for type narrowing.
 * @param condition The condition to check.
 * @param message The error message to throw if the condition is false.
 */
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const DEFAULT_RECONNECT_DELAY = 3000;
const DEFAULT_RETRY_DELAY = 5000;
const AUTH_TIMEOUT = 2 * 60 * 1000; // 2 minutes for auth flow
const TOOL_CALL_TIMEOUT = 5 * 60 * 1000; // 5 minutes for long-running tool calls
const POPUP_FEATURES = "width=600,height=700,resizable=yes,scrollbars=yes,status=yes";

// Define Transport types literal for clarity
type TransportType = "http" | "sse";

export type McpConnectionState =
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
  /** Forgets the user's sign-in to the server: the API deletes its OAuth grant. */
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
  /** The name the page gives itself to the server. */
  clientName?: string;
  debug?: boolean;
  autoRetry?: boolean | number;
  autoReconnect?: boolean | number;
  transportType?: "auto" | "http" | "sse";
  handleDisconnect?: () => void;
  /** A server on the user's machine, which the browser reaches directly. */
  isLocal?: boolean;
  /** "token" suppresses the OAuth flow: a 401 fails the connection instead of prompting auth. */
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
  } = useMemo(() => getOptions(options), [options]); // Memoize options to prevent unnecessary effect runs

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
  // Transport ref can hold either type now
  const transportRef = useRef<Transport | null>(null);
  const connectingRef = useRef<boolean>(false);
  const isMountedRef = useRef<boolean>(true);
  const connectAttemptRef = useRef<number>(0);
  const authTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // --- Refs for values used in callbacks ---
  const stateRef = useRef(data.state);
  // The state changes while a call is in flight, which reading it through a function keeps in view
  const isAuthenticating = () => stateRef.current === "authenticating";
  const autoReconnectRef = useRef(autoReconnect);
  // Ref to store the type of transport that successfully connected
  const successfulTransportRef = useRef<TransportType | null>(null);

  // --- Effect to keep refs updated ---
  useEffect(() => {
    stateRef.current = data.state;
    autoReconnectRef.current = autoReconnect;
  }, [data.state, autoReconnect]);

  // --- Stable Callbacks ---
  // addLog is stable (empty dependency array)
  const addLog = useCallback(
    (level: McpLogEntry["level"], message: string, ...args: unknown[]) => {
      if (!debug) return;
      const fullMessage =
        args.length > 0
          ? `${message} ${args.map((arg) => JSON.stringify(arg)).join(" ")}`
          : message;
      console[level](`[useMcp] ${fullMessage}`);
      // Use isMountedRef to prevent state updates after unmount
      if (isMountedRef.current) {
        dispatch({
          log: (prevLog) => [
            ...prevLog.slice(-100),
            { level, message: fullMessage, timestamp: Date.now() },
          ],
        });
      }
    },
    [isMountedRef, debug], // Empty dependency array makes this stable
  );

  // disconnect is stable (depends only on stable addLog)
  const disconnect = useCallback(
    async (quiet = false) => {
      if (!quiet) addLog("info", "Disconnecting...");
      connectingRef.current = false;
      if (authTimeoutRef.current) clearTimeout(authTimeoutRef.current);
      authTimeoutRef.current = null;

      const transport = transportRef.current;
      clientRef.current = null; // Ensure client is cleared
      transportRef.current = null; // Ensure transport is cleared

      // Only reset state if mounted and not a quiet disconnect
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
    [addLog, connectingRef, authTimeoutRef, isMountedRef, transportRef, clientRef], // Depends only on stable addLog
  );

  // failConnection is stable (depends only on stable addLog)
  const failConnection = useCallback(
    (errorMessage: string, connectionError?: Error) => {
      addLog("error", errorMessage, connectionError ?? "");
      if (isMountedRef.current) dispatch({ state: "failed", error: errorMessage });
      connectingRef.current = false; // Ensure connection attempt is marked as finished
      // Do not call disconnect here - allow user to see error and retry
    },
    [addLog, isMountedRef, connectingRef],
  ); // Depends only on stable addLog

  // When auth never completes (user left the popup open), fail the connection and
  // disable the server so it stops re-triggering the popup on every reload.
  const handleAuthTimeout = useCallback(() => {
    failConnection("Authentication timed out. Please try again.");
    if (serverId) {
      useMcpToolsStore.getState().disableServerAfterAuthCancel(serverId);
    }
    // The sign-in prompt for this server goes with it
    if (useThemeStore.getState().mcpAuthPopup?.url === url) {
      useThemeStore.getState().setMcpAuthPopup(null);
    }
  }, [failConnection, serverId, url]);

  /**
   * What a refused connection or call leads to. A remote OAuth server gets a sign-in: the
   * API prepares the OAuth flow and the page opens the authorization server in a popup;
   * the /oauth/callback page hands the result to the API and reports back on
   * {@link MCP_AUTH_CHANNEL}, which reconnects. Resolves whether a sign-in is under way;
   * otherwise the connection has failed.
   */
  const handleAuthRequired = useCallback(
    async (error: Error) => {
      // Token-auth servers never fall back to the OAuth flow: a 401 means the
      // static token is missing/invalid, so surface a token-specific error.
      if (usesTokenAuth) {
        failConnection(
          `Couldn't authenticate with ${serverName || "the MCP server"}. Check that your token is valid and not expired.`,
          error,
        );
        return false;
      }
      // The API signs in only to the servers it proxies: a local server takes its headers
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
      authTimeoutRef.current = setTimeout(handleAuthTimeout, AUTH_TIMEOUT);
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

  /**
   * The fetch the transports use. A remote server goes through the API's proxy, which
   * adds the server's stored credentials; a local server is called directly with the
   * headers the API keeps for it, held in memory for this connection only.
   */
  const createFetch = useCallback(async (): Promise<FetchLike> => {
    if (!isLocal) return createMcpProxyFetch(url);
    const server = useMcpToolsStore.getState().servers.find((s) => s.id === serverId);
    const headers = server?.customHeaderNames?.length
      ? await getLocalMcpServerHeaders(url)
      : {};
    return createLocalMcpFetch(headers);
  }, [url, isLocal, serverId]);

  // connect needs to be stable. Remove state/autoReconnect deps, use refs inside.
  const connect = useCallback(async () => {
    // Prevent concurrent connections
    if (connectingRef.current) {
      addLog("debug", "Connection attempt already in progress.");
      return;
    }
    if (!isMountedRef.current) {
      addLog("debug", "Connect called after unmount, aborting.");
      return;
    }

    connectingRef.current = true; // Mark start of connection sequence
    connectAttemptRef.current += 1;
    successfulTransportRef.current = null; // Reset successful transport type
    dispatch({ state: "discovering", error: undefined });
    addLog("info", `Connecting attempt #${connectAttemptRef.current} to ${url}...`);

    let fetchFn: FetchLike;
    try {
      // Headers the user just entered reach the API before the connection needs them
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

    // --- Helper function for a single connection attempt ---
    const tryConnectWithTransport = async (
      transportType: TransportType,
    ): Promise<"success" | "fallback" | "auth_required" | "failed"> => {
      addLog(
        "info",
        `Attempting connection with ${transportType.toUpperCase()} transport...`,
      );
      // Ensure state reflects current attempt phase, unless already authenticating
      if (stateRef.current !== "authenticating") {
        dispatch({ state: "connecting" });
      }

      let transportInstance: Transport; // Use base Transport type

      // 1. Create Transport Instance & Close Previous
      try {
        assert(clientRef.current, "Client must be initialized");

        // Close existing transport before creating new one
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
        transportRef.current = transportInstance; // Assign to ref immediately
        addLog(
          "debug",
          `${transportType.toUpperCase()} transport created and assigned to ref.`,
        );
      } catch (err) {
        // Use stable failConnection
        failConnection(
          `Failed to create ${transportType.toUpperCase()} transport: ${err instanceof Error ? err.message : String(err)}`,
          err instanceof Error ? err : undefined,
        );
        return "failed"; // Indicate definitive failure
      }

      // 2. Setup Handlers for the new transportInstance
      transportInstance.onmessage = (message: JSONRPCMessage) => {
        // Use stable addLog
        addLog("debug", `[Transport] Received: ${JSON.stringify(message)}`);
      };
      transportInstance.onerror = (err: Error) => {
        // Transport errors usually mean connection is lost/failed definitively for this transport
        addLog("warn", `Transport error event (${transportType.toUpperCase()}):`, err);
        if (isAuthError(err)) return; // The connect or call that hit it handles the sign-in
        if (!(err instanceof StreamableHTTPError && err.code === 504))
          // Use stable failConnection
          failConnection(
            `Transport error (${transportType.toUpperCase()}): ${err.message}`,
            err,
          );
      };
      transportInstance.onclose = () => {
        // Use refs for checks and stable callbacks
        if (!isMountedRef.current || connectingRef.current) return; // Ignore if connecting/unmounted

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
              connect(); // Start full connect logic again (will default to HTTP)
            }
          }, delay);
        } else if (currentState !== "failed" && currentState !== "authenticating") {
          // Use stable failConnection
          failConnection("Connection closed unexpectedly.");
        }
      };

      // 3. Attempt client.connect()
      try {
        addLog("info", `Connecting client via ${transportType.toUpperCase()}...`);

        const client = clientRef.current;
        assert(client, "Client must be initialized");
        await client.connect(transportInstance);

        // --- Success Path ---
        addLog(
          "info",
          `Client connected via ${transportType.toUpperCase()}. Loading tools, resources, and prompts...`,
        );
        successfulTransportRef.current = transportType; // Store successful type

        // Load resources after tools (optional - not all servers support resources)
        let resourcesResponse: {
          resources: Resource[];
          resourceTemplates?: ResourceTemplate[];
        } = { resources: [], resourceTemplates: [] };
        try {
          resourcesResponse = (await client.request(
            { method: "resources/list" },
            ListResourcesResultSchema,
          )) as { resources: Resource[]; resourceTemplates?: ResourceTemplate[] }; // Ensure type safety
        } catch (err) {
          if (isAuthError(err)) throw err; // Let the outer catch handle it
          addLog("debug", "Server does not support resources/list method", err);
        }

        dispatch({ state: "loading" });
        const toolsResponse = await client.request(
          { method: "tools/list" },
          ListToolsResultSchema,
        );

        // Load prompts after resources (optional - not all servers support prompts)
        let promptsResponse: { prompts: Prompt[] } = { prompts: [] };
        try {
          promptsResponse = (await client.request(
            { method: "prompts/list" },
            ListPromptsResultSchema,
          )) as { prompts: Prompt[] }; // Ensure type safety
        } catch (err) {
          if (isAuthError(err)) throw err; // Let the outer catch handle it
          addLog("debug", "Server does not support prompts/list method", err);
        }

        if (isMountedRef.current) {
          // Check mount before final state updates
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
          dispatch({ state: "ready" }); // Final success state
          connectAttemptRef.current = 0; // Reset on success
          return "success";
        }
        return "failed"; // Failed due to unmount after connect but before ready
      } catch (connectErr) {
        // --- Error Handling Path ---
        addLog(
          "debug",
          `Client connect error via ${transportType.toUpperCase()}:`,
          connectErr,
        );
        const errorInstance =
          connectErr instanceof Error ? connectErr : new Error(String(connectErr));

        // Check for 404/405 specifically for HTTP transport
        const errorMessage = errorInstance.message;
        const is404 =
          errorMessage.includes("404") || errorMessage.includes("Not Found");
        const is405 =
          errorMessage.includes("405") || errorMessage.includes("Method Not Allowed");
        const isLikelyCors =
          errorMessage === "Failed to fetch" /* Chrome */ ||
          errorMessage ===
            "NetworkError when attempting to fetch resource." /* Firefox */ ||
          errorMessage === "Load failed"; /* Safari */

        if (transportType === "http" && (is404 || is405 || isLikelyCors)) {
          addLog(
            "warn",
            `HTTP transport failed (${isLikelyCors ? "CORS" : is404 ? "404" : "405"}).`,
          );
          return "fallback"; // Signal that fallback should be attempted
        }

        if (isAuthError(errorInstance, errorMessage)) {
          addLog("info", "Authentication required.");
          return (await handleAuthRequired(errorInstance)) ? "auth_required" : "failed";
        }

        // Handle other connection errors
        failConnection(
          `Failed to connect via ${transportType.toUpperCase()}: ${errorMessage}`,
          errorInstance,
        );
        return "failed";
      }
    }; // End of tryConnectWithTransport helper

    // --- Orchestrate Connection Attempts ---
    let finalStatus: "success" | "auth_required" | "failed" | "fallback";

    if (transportType === "sse") {
      // SSE only - skip HTTP entirely
      addLog("debug", "Using SSE-only transport mode");
      finalStatus = await tryConnectWithTransport("sse");
    } else if (transportType === "http") {
      // HTTP only - no fallback
      addLog("debug", "Using HTTP-only transport mode");
      finalStatus = await tryConnectWithTransport("http");
    } else {
      // Auto mode - try HTTP first, fallback to SSE
      addLog("debug", "Using auto transport mode (HTTP with SSE fallback)");
      finalStatus = await tryConnectWithTransport("http");

      // Try SSE only if HTTP requested fallback
      if (finalStatus === "fallback" && isMountedRef.current) {
        addLog("info", "HTTP failed, attempting SSE fallback...");
        finalStatus = await tryConnectWithTransport("sse");
      }
    }

    // --- Finalize Connection State ---
    // A sign-in in progress reconnects from the callback
    connectingRef.current = false;
    if (finalStatus === "failed" && isMountedRef.current) handleDisconnect?.();
    addLog("debug", `Connection sequence finished with status: ${finalStatus}`);
  }, [
    // Stable callback dependencies
    addLog,
    failConnection,
    handleAuthRequired,
    handleDisconnect,
    createFetch,
    // Configuration dependencies
    url,
    clientName,
    transportType,
    // No state/autoReconnect dependency here

    stateRef,
    clientRef,
    transportRef,
    connectingRef,
    connectAttemptRef,
    isMountedRef,
    successfulTransportRef,
    autoReconnectRef,
  ]);

  // callTool is stable (depends on stable addLog, failConnection, connect, and URL)
  const callTool = useCallback(
    async (name: string, args?: Record<string, unknown>) => {
      const state = data.state; // Use current state from data
      // Use stateRef for check, state for throwing error message
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
        // Re-throw original error unless waiting for a sign-in
        if (!isAuthenticating()) throw err;
        // The UI reacts to the 'authenticating' state; the sign-in reconnects
        return undefined;
      }
    },
    [data.state, addLog, handleAuthRequired, stateRef, clientRef], // Depends on state for error message, url, and stable callbacks
  );

  // retry reconnects: after a failure, or to pick up the credentials just saved
  const retry = useCallback(() => {
    if (connectingRef.current) {
      addLog("warn", "Retry called while connecting. Ignoring.");
      return;
    }
    addLog("info", "Retry requested...");
    // connect() will handle resetting state and error internally
    connect();
  }, [addLog, connect, connectingRef]); // Depends only on stable callbacks

  // clearStorage forgets the sign-in, which the API keeps, and disconnects
  const clearStorage = useCallback(() => {
    deleteMcpOAuthGrant(url).catch((error) =>
      addLog("warn", `Failed to forget the sign-in for ${url}:`, error),
    );
    disconnect();
  }, [url, addLog, disconnect]);

  // listResources is stable (depends on stable addLog)
  const listResources = useCallback(async () => {
    const state = data.state; // Use current state from data
    // Use stateRef for check, state for throwing error message
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
  }, [data.state, addLog]); // Depends on state for error message and stable addLog

  // readResource is stable (depends on stable addLog)
  const readResource = useCallback(
    async (uri: string) => {
      const state = data.state; // Use current state from data
      // Use stateRef for check, state for throwing error message
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
  ); // Depends on state for error message and stable addLog

  // listPrompts is stable (depends on stable addLog)
  const listPrompts = useCallback(async () => {
    const state = data.state; // Use current state from data
    // Use stateRef for check, state for throwing error message
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
  }, [data.state, addLog, stateRef, isMountedRef, clientRef]); // Depends on state for error message and stable addLog

  // getPrompt is stable (depends on stable addLog)
  const getPrompt = useCallback(
    async (name: string, args?: Record<string, string>) => {
      const state = data.state; // Use current state from data
      // Use stateRef for check, state for throwing error message
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
  ); // Depends on state for error message and stable addLog

  // ===== Effects =====

  // The /oauth/callback window reports a finished sign-in
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

  // Initial Connection (depends on config and stable callbacks)
  useEffect(() => {
    isMountedRef.current = true;
    addLog("debug", "useMcp mounted, initiating connection.");
    connectAttemptRef.current = 0;
    connect(); // Call stable connect
    return () => {
      isMountedRef.current = false;
      addLog("debug", "useMcp unmounting, disconnecting.");
      disconnect(true); // Call stable disconnect
    };
  }, [url, connect, disconnect, isMountedRef, connectAttemptRef]);

  // Auto-Retry (depends on state, config, stable callbacks)
  useEffect(() => {
    let retryTimeoutId: NodeJS.Timeout | null = null;
    // Use state directly here, as this effect *should* run when state changes to 'failed'
    if (data.state === "failed" && autoRetry && connectAttemptRef.current > 0) {
      const delay = typeof autoRetry === "number" ? autoRetry : DEFAULT_RETRY_DELAY;
      addLog("info", `Connection failed, auto-retrying in ${delay}ms...`);
      retryTimeoutId = setTimeout(() => {
        // Check mount status and state again before retrying
        if (isMountedRef.current && stateRef.current === "failed") {
          retry(); // Call stable retry
        }
      }, delay);
    }
    return () => {
      if (retryTimeoutId) clearTimeout(retryTimeoutId);
    };
    // Depends on state (to trigger), autoRetry config, and stable retry/addLog callbacks
  }, [data.state === "failed", autoRetry, retry, addLog]);

  // --- Return Public API ---
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
