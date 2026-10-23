import type { AxiosError } from "axios";
import { toast } from "sonner";
import { z } from "zod";
import type { SearchableChat } from "~/components/AI/hooks/useChatSearch";
import type { WidgetJsonT, WidgetT } from "~/components/types";
import type { WidgetId } from "~/components/Widgets";
import { fetchBackend } from "~/lib/api";
import { type Extension, VERSION } from "~/lib/constants";
import { getConfig } from "~/lib/runtimeConfig";
import type { Usage, UserAccess } from "~/lib/state/access";
import {
  type Source,
  type StoredFile,
  useBackendConnectorStore,
  type WidgetMetadata,
  type WidgetMetadataItem,
} from "~/lib/state/backendConnector";
import {
  type AIMessage,
  type Chat,
  type Copilot,
  copilotSchema,
  type ExternalCopilotHolder,
  type HumanMessage,
} from "~/lib/state/copilot";
import type { EntityThemeSettings } from "~/lib/state/entityTheme";
import type { McpServer } from "~/lib/state/mcpTools";
import {
  type UserAppReturn,
  type UserAppsSync,
  useUserAppsStore,
} from "~/lib/state/userApps";
import { createURL, createURLString, processWidgetId, uuidv4 } from "~/lib/utils";
import { addExtraHeaders } from "~/lib/utils/widgetParams";
import type {
  Detail,
  Login2FAResponse,
  LoginResponse,
  MetaDataWidgetType,
  Prompt,
  SessionResponse,
  Skill,
  SkillCreate,
  SuccessReturn,
  WidgetMetadataResponse,
} from "~/types/auth.type";
import { handleWidgetMetadata } from "~/utils/dataConnectorsHelpers";
import { formatZodErrorMessage } from "~/utils/zodErrors";
import { apiClient } from "./api";
import { getErrorResponse, loginFailure } from "./errors";

export interface PostApiSource {
  name: string;
  url: string;
  endpointHeaders?:
    | { key: string; value: string; location?: "headers" | "query" }[]
    | null;
}

export type PostFileWidget = PostApiSource &
  WidgetMetadata & {
    stored_file_uuid?: string;
    extension: Extension;
    dataKey: null | string;
    originalFileName: null | string;
    source?: null | string;
  };

export type PostUploadFileResponse = {
  stored_file_uuid: string;
  original_file_name: string;
  extension: Extension;
  url: string;
  failed: boolean;
}[];

export type CustomCopilot = {
  uuid: string;
  url: string;
  headers: Record<string, string>;
  copilots: Copilot[];
  enabled?: boolean;
};

export async function login(
  email: string,
  password: string,
  remember = false,
  totpToken: null | number = null,
): Promise<LoginResponse | Login2FAResponse> {
  try {
    const { data, status } = await apiClient.post<LoginResponse>("/app/login", {
      email,
      password,
      remember,
      source: "app",
      totp_token: totpToken,
      version: VERSION,
    });
    return { status, ...data };
  } catch (e) {
    return loginFailure(e);
  }
}

export async function validateUser() {
  const { data } = await apiClient.get("/app/validate");
  return data;
}

export async function getSession(): Promise<SessionResponse | null> {
  const { data } = await apiClient
    .get<SessionResponse>("/app/session")
    .catch((_e: AxiosError) => ({ data: null }));
  return data;
}

export async function logout(): Promise<SuccessReturn> {
  const { data } = await apiClient
    .post<SuccessReturn>("/app/logout")
    .catch((e: AxiosError) => {
      console.error("Logout failed:", e);
      const success = [e?.response?.status, e?.status].some((v) => v === 401);
      return { data: { success } as SuccessReturn };
    });
  return data;
}

export async function googleLogin(
  token: string,
): Promise<LoginResponse | Login2FAResponse> {
  try {
    const { data, status } = await apiClient.post<LoginResponse>("/app/google-auth", {
      token,
      version: VERSION,
    });
    return { status, ...data };
  } catch (e) {
    return loginFailure(e);
  }
}

export async function getSignInNonce(): Promise<string> {
  const { data } = await apiClient.post<{ nonce: string }>("/app/sign-in/nonce");
  return data.nonce;
}

export const SIGN_IN_EXPIRED = "The sign-in has expired; please sign in again";

export async function withSignInNonce<
  T extends { response: LoginResponse | Login2FAResponse },
>(signIn: (nonce: string) => Promise<T>): Promise<T> {
  const first = await signIn(await getSignInNonce());
  const { response } = first;
  const expired =
    response.status === 400 &&
    "detail" in response &&
    response.detail === SIGN_IN_EXPIRED;
  return expired ? signIn(await getSignInNonce()) : first;
}

export async function microsoftLogin(
  token: string,
  idToken: string,
): Promise<LoginResponse | Login2FAResponse> {
  try {
    const { data, status } = await apiClient.post("/app/microsoft-auth", {
      token,
      id_token: idToken,
      version: VERSION,
    });
    return { status, ...data };
  } catch (e) {
    return loginFailure(e);
  }
}

export async function oktaLogin(
  token: string,
  idToken: string,
): Promise<LoginResponse | Login2FAResponse> {
  try {
    const { data, status } = await apiClient.post("/app/okta-auth", {
      token,
      id_token: idToken,
      version: VERSION,
    });
    return { status, ...data };
  } catch (e) {
    return loginFailure(e);
  }
}

export async function getCustomCopilotSchema() {
  const { data } = await apiClient.get<CustomCopilot[]>("/app/custom-copilot");
  return data;
}

export async function removeCustomCopilot(uuid: string) {
  const { data } = await apiClient.delete(`/app/custom-copilot/${uuid}`);
  return data;
}
export async function putCustomCopilot(copilot: ExternalCopilotHolder) {
  const { data } = await apiClient.put("/app/custom-copilot", copilot);
  return data;
}

export type ChatUsage = { status?: number; usage?: Usage };
export type ChatDiff = Omit<Chat, "messages"> & {
  messages?: Record<string, Chat["messages"][number] | "DELETE">;
};
export type PostUserChats = Record<string, ChatDiff | "DELETE">;

export async function postUserChats(chats: PostUserChats): Promise<ChatUsage> {
  try {
    const usage = await apiClient
      .post<Usage>("/app/copilot-chats", { chats })
      .then((res) => ({ status: res.status, usage: res.data }))
      .catch((e: AxiosError) => {
        return { status: getErrorResponse(e).status || 500 };
      });
    return usage;
  } catch (e) {
    console.error("Error posting user chats:", e);
    return { status: getErrorResponse(e).status || 500 };
  }
}

type SearchResponse = Omit<Chat<HumanMessage | AIMessage>, "artifacts">[];

export async function searchChats(searchQuery: string) {
  const { data } = await apiClient
    .get<SearchResponse>("/app/copilot-chats/search", {
      params: { query: searchQuery.trim() },
    })
    .catch((_e: AxiosError) => ({ data: [] as SearchResponse }));

  const results = data.map((chat) => {
    const { messages = [], ...rest } = chat;
    return {
      ...rest,
      recentMessages: messages.map((msg) => msg.content).filter(Boolean),
    } as SearchableChat;
  });

  return { results, searchQuery };
}

export async function getCopilotChat(chatUuid: string): Promise<Chat | null> {
  const { data } = await apiClient
    .get(`/app/copilot-chats/${chatUuid}`)
    .catch((_e: AxiosError) => ({ data: null }));
  return data;
}

export async function updatePassword(
  oldPassword: string,
  newPassword: string,
): Promise<number> {
  const { status } = await apiClient
    .put("/user", {
      old_password: oldPassword,
      new_password: newPassword,
    })
    .catch((e: AxiosError) => {
      return { status: getErrorResponse(e).status || 500 };
    });
  return status;
}

export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<{ status: number; detail?: string }> {
  try {
    const { status } = await apiClient.post("/app/reset-password", {
      token,
      new_password: newPassword,
    });
    return { status };
  } catch (e) {
    const { status, data } = getErrorResponse(e);
    return {
      status: status || 500,
      detail: typeof data.detail === "string" ? data.detail : undefined,
    };
  }
}

export async function generateQRCode(): Promise<{
  uri: string;
  secret: string;
} | null> {
  try {
    const { data } = await apiClient.post("/totp");
    return data;
  } catch (_e) {
    return null;
  }
}

export async function activateTotp(
  totpToken: number,
  signIn?: { remember: boolean },
): Promise<number> {
  const response = await fetchBackend(`${getConfig().urls.backend}/totp/activate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      totp_token: totpToken,
      ...(signIn && { remember: signIn.remember, version: VERSION }),
    }),
  }).catch(() => null);
  return response?.status ?? 500;
}

export async function getApiSources(): Promise<Source[]> {
  const { data } = await apiClient
    .get("/app/data-connectors/api-source")
    .catch((_e: AxiosError) => {
      return { data: [] };
    });
  return data;
}

export async function postApiSource(
  sourceUuid: string,
  data: PostApiSource,
): Promise<{ status: number }> {
  const { status } = await apiClient
    .post(`/app/data-connectors/api-source/${sourceUuid}`, { ...data })
    .catch((e: AxiosError) => {
      return { status: getErrorResponse(e).status || 500 };
    });
  return { status };
}

export async function deleteApiSource(sourceUuid: string): Promise<{ status: number }> {
  const { status } = await apiClient
    .delete(`/app/data-connectors/api-source/${sourceUuid}`)
    .catch((e: AxiosError) => {
      return { status: getErrorResponse(e).status || 500 };
    });
  return { status };
}

type PresignedUrlReturn = {
  pre_signed_url: string;
  stored_file_uuid: string;
  original_file_name: string;
};

export async function getFileWidgets(): Promise<StoredFile[]> {
  const { data } = await apiClient
    .get("/app/data-connectors/file")
    .catch((_e: AxiosError) => {
      return { data: [] };
    });
  return data;
}

export async function postFileWidget(
  sourceUuid: string,
  data: PostFileWidget,
  signal?: AbortSignal,
): Promise<{ status: number }> {
  const { status } = await apiClient
    .post(`/app/data-connectors/file/${sourceUuid}`, { ...data }, { signal })
    .catch((e: AxiosError) => {
      return { status: getErrorResponse(e).status || 500 };
    });

  return { status };
}

export async function deleteUploadedFile(
  fileUuid: string,
): Promise<{ status: number }> {
  const { status } = await apiClient
    .delete(`/app/files/${fileUuid}`)
    .catch((e: AxiosError) => {
      return { status: getErrorResponse(e).status || 500 };
    });

  return { status };
}

export async function getStoredFileBlob(fileUrl: string): Promise<Blob> {
  const { data } = await apiClient.get<Blob>(fileUrl, { responseType: "blob" });
  return data;
}

export async function getPreSignedUrl(
  fileUuid: string,
  expiration = 900,
): Promise<PresignedUrlReturn> {
  const { data } = await apiClient
    .get<PresignedUrlReturn>(`/app/files/${fileUuid}/presigned-url`, {
      params: { expiration },
    })
    .catch((_e: AxiosError) => {
      return { data: {} as PresignedUrlReturn };
    });
  return data;
}

export async function deleteUploadedFiles(
  fileUuids: string[],
): Promise<{ status: number }> {
  const { status } = await apiClient
    .delete("/app/files", { data: { file_uuids: fileUuids } })
    .catch((e: AxiosError) => {
      return { status: getErrorResponse(e).status || 500 };
    });

  return { status };
}

export async function deleteFileWidget(
  sourceUuid: string,
): Promise<{ status: number }> {
  try {
    const { status } = await apiClient
      .delete(`/app/data-connectors/file/${sourceUuid}`)
      .catch((e: AxiosError) => {
        return { status: getErrorResponse(e).status || 500 };
      });
    return { status };
  } catch (e) {
    return { status: getErrorResponse(e).status || 500 };
  }
}

export async function getWidgetMetadata(): Promise<WidgetMetadataItem[]> {
  const { data } = await apiClient.get<WidgetMetadataItem[]>("/app/widget-metadata");
  return data;
}

export async function postWidgetMetadata(
  widgetMetadata: WidgetMetadataResponse,
): Promise<SuccessReturn> {
  const { data } = await apiClient.post<SuccessReturn>(
    "/app/widget-metadata",
    widgetMetadata,
  );
  return data;
}

export async function getUserAppsData(): Promise<UserAppsSync> {
  const { data } = await apiClient.get<UserAppsSync>("/app/user-apps/sync");
  return data;
}

export async function syncUserApps() {
  const data = await getUserAppsData();
  useUserAppsStore.getState().updateUserApps(data);
}

export async function postUserApp(
  app_uuid: string,
  userApp: UserAppReturn["content"],
): Promise<UserAppsSync> {
  const { data } = await apiClient.post<UserAppsSync>(
    `/app/user-apps/${app_uuid}`,
    userApp,
  );
  return data;
}

export async function deleteUserApp(uuid: string): Promise<UserAppsSync> {
  const { data } = await apiClient.delete<UserAppsSync>(`/app/user-apps/${uuid}`);

  return data;
}

export async function getUserAppShares(userAppUuid: string) {
  const { data } = await apiClient.get(`/app/user-apps/${userAppUuid}/shares`);
  return data;
}

export async function shareUserApp(userAppUuid: string, emails: string) {
  const emailArray = emails.split(",");

  const shares = emailArray.reduce<Record<string, "view">>((acc, email) => {
    acc[email] = "view";
    return acc;
  }, {});

  const { data } = await apiClient
    .post(`/app/user-apps/${userAppUuid}/share`, {
      shares,
    })
    .catch((e) => {
      if (e?.response?.data) {
        const { data } = e.response;
        const success = data?.success ?? false;
        return { data: { success, detail: data.detail } };
      }
      return { data: { success: false, detail: "Unable to share dashboard" } };
    });

  return data;
}

export async function deleteUserAppShare(
  userAppUuid: string,
  emails: string[],
): Promise<SuccessReturn & Detail> {
  const url = `/app/user-apps/${userAppUuid}/share`;

  const { data } = await apiClient
    .delete(url, {
      data: { shares: emails },
    })
    .catch((e) => {
      if (e?.response?.data) {
        const { data } = e.response;
        const success = data?.success ?? false;
        return { data: { success, detail: data.detail } };
      }
      return { data: { success: false, detail: "Unable to share dashboard" } };
    });

  return data;
}

export async function getUserAppShareUsers(userAppUuid: string) {
  const { data } = await apiClient.get(`/app/user-apps/${userAppUuid}/shares/users`);
  return data;
}

export async function patchWidgetMetadata(
  widgetMetadata: Partial<WidgetMetadataResponse>,
  widgetId?: string,
): Promise<SuccessReturn> {
  const params = new URLSearchParams();
  if (widgetId) params.append("widget_id", widgetId);

  const { data } = await apiClient.patch<SuccessReturn>(
    "/app/widget-metadata",
    widgetMetadata,
    { params },
  );
  return data;
}

export async function deleteWidgetMetadata(
  widgetId: string,
): Promise<WidgetMetadataItem[]> {
  const { data } = await apiClient.delete<WidgetMetadataItem[]>(
    `/app/widget-metadata/${widgetId}`,
  );
  return data;
}

export async function getUsage(): Promise<Usage> {
  const { data } = await apiClient
    .get<Usage>("/app/usage")
    .catch(() => ({ data: {} as Usage }));

  return data;
}

export async function getAccess(): Promise<UserAccess> {
  const { data } = await apiClient.get<UserAccess>("/app/access");
  return data;
}

export const postUserPrompts = async (prompts: Prompt[]): Promise<SuccessReturn> => {
  const { data } = await apiClient.post<SuccessReturn>("/app/prompts", prompts);
  return data;
};

export const getUserPrompts = async (): Promise<Prompt[]> => {
  const { data } = await apiClient.get<Prompt[]>("/app/prompts");
  return data;
};

export const createUserSkill = async (skill: SkillCreate) => {
  const { data } = await apiClient
    .post<Skill[]>("/app/skills", skill)
    .catch(() => ({ data: null }));
  return data;
};

export const deleteUserSkills = async (skillId: string | string[]) => {
  const skillIds = Array.isArray(skillId) ? skillId : [skillId];
  const { data } = await apiClient
    .delete<Skill[]>("/app/skills", { data: skillIds })
    .catch(() => ({ data: null }));
  return data;
};

export const updateUserSkill = async (skillId: string, skill: SkillCreate) => {
  const { data } = await apiClient
    .patch<Skill[]>(`/app/skills/${skillId}`, skill)
    .catch(() => ({ data: null }));
  return data;
};

export async function putUser2FA(payload: {
  two_factor_auth: boolean;
}): Promise<SuccessReturn> {
  const { data } = await apiClient.put<SuccessReturn>("/app/2fa", payload);
  return data;
}

export async function getUser2FA(): Promise<{
  data: {
    two_factor_auth: boolean;
    entity_require_authenticator: boolean;
  };
}> {
  const { data } = await apiClient.get<{
    two_factor_auth: boolean;
    entity_require_authenticator: boolean;
  }>("/app/2fa");
  return { data };
}

export function getAgentConnectionErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Could not connect to the agent server. Please try again.";
  }

  const message = error.message?.trim();
  if (!message) {
    return "Could not connect to the agent server. Please try again.";
  }

  if (error.name === "AbortError") {
    return message;
  }

  const lowered = message.toLowerCase();
  const isNetworkFailure =
    message === "Failed to fetch" ||
    message === "Load failed" ||
    message === "NetworkError when attempting to fetch resource." ||
    lowered.includes("failed to fetch") ||
    lowered.includes("networkerror");

  if (isNetworkFailure) {
    return "Could not reach the agent server. Check the URL, ensure the server is running, and allow CORS from this app origin.";
  }

  if (lowered.includes("cors")) {
    return "The agent server blocked the request (CORS). Allow this app origin and try again.";
  }

  return message;
}

export async function fetchAgentsData(
  holder: Partial<CustomCopilot>,
  signal?: AbortSignal,
): Promise<Copilot[]> {
  const initRequest: RequestInit = {
    headers: addExtraHeaders(holder?.headers),
    signal,
  };

  let res: Response;
  try {
    res = await fetch(createURL("agents.json", holder.url), initRequest).then((res) =>
      res.ok ? res : fetch(createURL("copilots.json", holder.url), initRequest),
    );
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }
    throw new Error(getAgentConnectionErrorMessage(error));
  }

  if (!res.ok) {
    switch (res.status) {
      case 401: {
        throw new Error("Unauthorized access to the agent URL.");
      }
      case 404: {
        throw new Error("A valid /agents.json was not found.");
      }
      case 500: {
        throw new Error("Internal server error.");
      }
      default: {
        throw new Error("Unknown error occurred while validating URL.");
      }
    }
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch (_) {
    throw new Error(
      "Invalid response from the agent server. Expected valid JSON in /agents.json.",
    );
  }

  const rawAgents = data as Record<string, Copilot>;
  const dataArray = Object.entries(rawAgents).map(
    ([id, copilot]: [string, Copilot]) => {
      const endpoints = copilot?.endpoints;
      if (endpoints) {
        for (const key of Object.keys(endpoints) as (keyof typeof endpoints)[]) {
          const value = endpoints[key];
          if (value !== undefined) endpoints[key] = createURLString(value, holder.url);
        }
      }
      if (copilot.image) copilot.image = createURLString(copilot.image, holder.url);
      return { ...copilot, id: copilot.id ?? id, holderUuid: holder?.uuid };
    },
  );

  try {
    return z.array(copilotSchema).parse(dataArray);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(
        "Invalid agents schema from the server. Please validate your /agents.json format.",
      );
    }
    throw error;
  }
}

export async function fetchDefaultAgent(
  signal?: AbortSignal,
): Promise<Copilot | undefined> {
  const url = getConfig().urls.ai;
  if (!url) return undefined;
  const agents = await fetchAgentsData({ url }, signal);
  return agents.find((agent) => agent.id === "default_agent");
}

export function hasCopilotConflict(
  copilots: Copilot[],
  existingCopilots: Copilot[],
  silent = false,
) {
  for (const newAgent of copilots) {
    const { duplicateNames, duplicateIds } = existingCopilots.reduce(
      (acc, agent) => {
        if (agent.name.toLowerCase() === newAgent.name.toLowerCase()) {
          acc.duplicateNames.push(agent.name);
        }
        if (agent.id === newAgent.id) {
          acc.duplicateIds.push(agent.id);
        }
        return acc;
      },
      { duplicateNames: [] as string[], duplicateIds: [] as string[] },
    );
    const conflicts = {
      ID: duplicateIds.length > 0 && `\`${newAgent.id}\``,
      name: duplicateNames.length > 0 && `\`${newAgent.name}\``,
    };

    if (conflicts.ID || conflicts.name) {
      const { labels, conflictMessages } = Object.entries(conflicts)
        .filter(([, value]) => value)
        .reduce(
          (acc, [key, value]) => {
            acc.labels.push(key);
            acc.conflictMessages.push(`${key} ${value}`);
            return acc;
          },
          { labels: [] as string[], conflictMessages: [] as string[] },
        );
      if (silent) return true;

      toast.error(`Agent ${labels.join(" and ")} conflict`, {
        description: formatZodErrorMessage(
          `\nThe agent ${conflictMessages.join(" and ")} already exist. Please ensure each agent has a unique ${labels.join(" and ")}.`,
        ),
      });
      return true;
    }
  }

  return false;
}

export async function getExternalCopilotHolders(
  customCopilots?: CustomCopilot[],
  updateHolders?: (holders: ExternalCopilotHolder[]) => void,
) {
  if (!customCopilots || customCopilots.length === 0) {
    customCopilots = await getCustomCopilotSchema();
  }

  const externalCopilotHolders = await Promise.all(
    customCopilots.map(async (holder): Promise<ExternalCopilotHolder> => {
      try {
        const copilots = await fetchAgentsData(holder);
        const hasConflict = hasCopilotConflict(
          copilots,
          customCopilots
            .flatMap((h) => h.copilots || [])
            .filter((c) => c.holderUuid !== holder.uuid),
          true,
        );
        if (hasConflict)
          return {
            status: "error",
            enabled: holder.enabled !== false,
            ...holder,
          };

        putCustomCopilot({ ...holder, copilots });

        return {
          status: "success",
          enabled: holder.enabled !== false,
          ...holder,
          copilots,
        };
      } catch (err) {
        console.error("Error fetching custom agents:", err);

        const hasCopilots =
          Array.isArray(holder.copilots) && holder.copilots.length > 0;
        const currentCopilots = hasCopilots ? holder.copilots : [];
        for (const copilot of currentCopilots) copilot.holderUuid = holder.uuid;

        const hasConflict = hasCopilotConflict(
          currentCopilots,
          customCopilots
            .flatMap((h) => h.copilots || [])
            .filter((c) => c.holderUuid !== holder.uuid),
          true,
        );
        if (!hasConflict) holder.copilots = currentCopilots;

        return {
          status: "error",
          enabled: holder.enabled !== false,
          ...holder,
        };
      }
    }),
  );

  updateHolders?.(externalCopilotHolders);
  return externalCopilotHolders;
}

export async function createMetaDataWidget(widget: WidgetT | WidgetJsonT) {
  const widgetInfo = processWidgetId(widget.widgetId ?? "", widget.connectionType);
  const metadata = handleWidgetMetadata(widget as WidgetT);

  if (metadata) return;

  const widgetMetadata = {
    name: widget?.name,
    description: widget?.description ?? "",
    category: widget?.category ?? "",
    subCategory: widget?.subCategory ?? "",
    source: widget?.source ?? "",
    storage: widget.storage,
  } as WidgetMetadataItem;

  let widgetId: WidgetId | undefined;
  try {
    const id = widgetInfo?.uuid || uuidv4();
    const widgetType = widgetInfo.cleanWidgetId as MetaDataWidgetType;

    const result = await postWidgetMetadata({
      ...widgetMetadata,
      widgetId: id,
      widgetType: widgetType,
    });
    widgetId = `${widgetType}-${id}`;
    if (!result.success) {
      throw new Error("Failed to create widget metadata");
    }
  } catch (error) {
    console.error("Error creating widget metadata:", error);
  } finally {
    if (widgetId) {
      const updatedMetadata = await getWidgetMetadata();
      useBackendConnectorStore.getState().setWidgetMetadata(updatedMetadata);
    }
  }

  return widgetId;
}

export async function getEntityThemeSettings(): Promise<EntityThemeSettings> {
  const { data } = await apiClient
    .get<EntityThemeSettings>("/app/theme-settings")
    .catch((_e: AxiosError) => {
      return { data: { light: null, dark: null } };
    });
  return data;
}

export async function postMCPServers(
  servers: McpServer[],
): Promise<{ status: number }> {
  try {
    const { status } = await apiClient
      .post("/app/mcp-servers", { servers })
      .catch((e: AxiosError) => {
        return { status: getErrorResponse(e).status || 500 };
      });
    return { status };
  } catch (e) {
    return { status: getErrorResponse(e).status || 500 };
  }
}
