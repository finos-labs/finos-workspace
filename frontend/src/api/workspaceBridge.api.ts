import type { AxiosError, AxiosResponse } from "axios";
import { apiClient } from "~/api/api";
import type { BrowserSessionStartResponse } from "~/components/AI/workspaceBridgeProtocol";
import { invalidateMcpTokens } from "~/components/LayoutAuth/useMcpTokens";
import { getConfig } from "~/lib/runtimeConfig";
import { createURLString } from "~/lib/utils/widgetParams";

interface StartBridgeSessionBody {
  client_name: string;
  current_dashboard_id: string | null;
  current_tab_id: string | null;
}

export interface WorkspaceMcpTokenMetadata {
  uuid: string;
  name: string;
  token_type: string;
  token_prefix: string;
  created_date?: string | null;
  updated_date?: string | null;
  last_used_at?: string | null;
}

interface WorkspaceMcpTokenCreateResponse extends WorkspaceMcpTokenMetadata {
  token: string;
}

export function getWorkspaceMcpEndpoint() {
  const baseUrl = createURLString(getConfig().urls.backend, window.location.origin);

  return createURLString("/mcp", baseUrl);
}

function catchError(error: AxiosError): never {
  throw new Error(
    error?.message ||
      `Workspace MCP request failed with status ${error?.response?.status}.`,
  );
}
function parseJsonResponse<T extends AxiosResponse, U = T["data"]>(
  resp: T,
  successStatus = 200,
): U {
  if (resp.status !== successStatus) {
    throw new Error(
      resp.statusText || `Workspace MCP request failed with status ${resp.status}.`,
    );
  }
  return resp.data;
}

export async function startBridgeSession(
  body: StartBridgeSessionBody,
  signal?: AbortSignal,
) {
  const resp = await apiClient
    .post<BrowserSessionStartResponse>(
      "/app/workspace-mcp/bridge/session/start",
      body,
      { signal },
    )
    .catch(catchError);

  if (resp.status === 200) invalidateMcpTokens();

  return parseJsonResponse(resp);
}

export async function listWorkspaceMcpTokens() {
  const resp = await apiClient
    .get<WorkspaceMcpTokenMetadata[]>("/app/workspace-mcp/tokens")
    .catch(catchError);

  return parseJsonResponse(resp);
}

export async function createWorkspaceMcpToken(
  name: string,
): Promise<WorkspaceMcpTokenCreateResponse> {
  const resp = await apiClient
    .post<WorkspaceMcpTokenCreateResponse>("/app/workspace-mcp/tokens", { name })
    .catch(catchError);
  return parseJsonResponse(resp);
}

export async function revokeWorkspaceMcpToken(tokenUuid: string): Promise<void> {
  const resp = await apiClient
    .delete(`/app/workspace-mcp/tokens/${tokenUuid}`)
    .catch(catchError);

  parseJsonResponse(resp, 204);
}
