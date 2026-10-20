import type { EntityThemeSettings } from "~/lib/state/entityTheme";
import type { EntityMapItem, EntitySettings } from "~/types/entity.type";
import type { CreateUserDTO, User, UserSources } from "~/types/user.type";
import { apiClient } from "./api";

interface BaseResponse {
  success: boolean;
  message?: string;
}

interface App {
  uuid: string;
  name: string;
  url: string;
  user_uuid: string;
  created_date: string;
  user_email: string;
  updated_date: string;
}

/* Users */

export async function getUsers() {
  const { data } = await apiClient.get<User[]>("/admin/users");
  return data;
}

export async function validateAdminAccess() {
  const { data } = await apiClient.get<BaseResponse>("/admin/validate");
  return data;
}

export async function inviteUser(user: CreateUserDTO) {
  const { data } = await apiClient.post<BaseResponse>("/admin/register", user);
  return data;
}

export async function updateUser(id: string, payload: Partial<User>) {
  const { data } = await apiClient.patch(`/admin/users/${id}`, payload);
  return data;
}

export async function deleteMe() {
  const { data } = await apiClient.delete<BaseResponse>("/user");
  return data;
}

export async function deleteUser(
  id: string,
  source: UserSources | undefined,
  remove?: boolean,
): Promise<{ success: boolean } | undefined> {
  if (source === "user") {
    if (remove) {
      // this endpoint removes the user from the entity
      const { data } = await apiClient.delete<BaseResponse>(
        `/admin/users/${id}/remove`,
      );
      return data;
    }
    // this endpoint soft deletes the user
    const { data } = await apiClient.delete<BaseResponse>(`/admin/users/${id}`);
    return data;
  }
  if (source === "invite") {
    const { data } = await apiClient.delete<BaseResponse>(`/admin/register/${id}`);
    return data;
  }
}

/** The link an admin gives a user to set their password with: it works once, until
 * expires_at. */
export type PasswordLinkAnswer = {
  success: boolean;
  link: string;
  expires_at: string;
};

/** Resets a user's password: the answer is the link with which they set a new one. */
export async function resetUserPassword(id: string) {
  const { data } = await apiClient.post<PasswordLinkAnswer>(
    `/admin/reset-password/${id}`,
  );
  return data;
}

export async function resetUser2FA(id: string) {
  const { data } = await apiClient.post<BaseResponse>(`/admin/reset-2fa/${id}`);
  return data;
}

/** Adds a user: the answer is the link with which they set their password. */
export async function createUser(user: CreateUserDTO) {
  const { data } = await apiClient.post<PasswordLinkAnswer>("/admin/create-user", user);
  return data;
}

/* Share requests */

export type ShareRequestUser = {
  email: string;
  first_name: string | null;
  last_name: string | null;
};

/** A share a developer asked for; an admin of their organization approves or declines it. */
export type ShareRequest = {
  uuid: string;
  created_date: string | null;
  requester: ShareRequestUser;
  item_type: "dashboard" | "app";
  item_uuid: string;
  item_name: string;
  /** Null: the whole organization */
  recipient: ShareRequestUser | null;
  permissions: string | null;
};

export async function getShareRequests() {
  const { data } = await apiClient.get<ShareRequest[]>("/admin/share-requests");
  return data;
}

export async function decideShareRequest(
  uuid: string,
  decision: "approve" | "decline",
) {
  const { data } = await apiClient.post<BaseResponse>(
    `/admin/share-requests/${uuid}/${decision}`,
  );
  return data;
}

/* Entities */

export async function getEntity() {
  const { data } = await apiClient.get<EntitySettings>("/admin/entity");
  return data;
}

export async function updateEntity(payload: Partial<EntitySettings>) {
  const { data } = await apiClient.patch<BaseResponse>("/admin/entity", payload);
  return data;
}

export async function getEntityMap() {
  const { data } = await apiClient.get<EntityMapItem[]>("/admin/entity-map");
  return data;
}

export async function getApps() {
  const response = await apiClient.get<App[]>("/admin/apps");
  return response.data;
}

export async function updateEntityThemeSettings(
  payload: EntityThemeSettings,
): Promise<BaseResponse> {
  const { data } = await apiClient
    .patch<BaseResponse>("/admin/theme-settings", payload)
    .catch(() => ({
      data: { success: false, message: "Failed to update theme settings" },
    }));
  return data;
}
