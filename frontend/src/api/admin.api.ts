import type { EntityThemeSettings } from "~/lib/state/entityTheme";
import type { ThemeVariants } from "~/lib/theme/sheet";
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
      const { data } = await apiClient.delete<BaseResponse>(
        `/admin/users/${id}/remove`,
      );
      return data;
    }
    const { data } = await apiClient.delete<BaseResponse>(`/admin/users/${id}`);
    return data;
  }
  if (source === "invite") {
    const { data } = await apiClient.delete<BaseResponse>(`/admin/register/${id}`);
    return data;
  }
}

export type PasswordLinkAnswer = {
  success: boolean;
  link: string;
  expires_at: string;
};

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

export async function createUser(user: CreateUserDTO) {
  const { data } = await apiClient.post<PasswordLinkAnswer>("/admin/create-user", user);
  return data;
}

export type ShareRequestUser = {
  email: string;
  first_name: string | null;
  last_name: string | null;
};

export type ShareRequest = {
  uuid: string;
  created_date: string | null;
  requester: ShareRequestUser;
  item_type: "dashboard" | "app";
  item_uuid: string;
  item_name: string;
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

export interface ThemePreset extends ThemeVariants {
  uuid: string;
  name: string;
}

export interface ThemePresets {
  presets: ThemePreset[];
  active_preset: string | null;
}

export async function getThemePresets() {
  const { data } = await apiClient.get<ThemePresets>("/admin/theme-presets");
  return data;
}

export async function putThemePreset(preset: ThemePreset) {
  const { uuid, ...body } = preset;
  const { data } = await apiClient.put<ThemePreset>(
    `/admin/theme-presets/${uuid}`,
    body,
  );
  return data;
}

export async function deleteThemePreset(uuid: string) {
  const { data } = await apiClient.delete<ThemePresets>(`/admin/theme-presets/${uuid}`);
  return data;
}

export async function putActiveThemePreset(uuid: string | null) {
  const { data } = await apiClient.put<ThemePresets>("/admin/theme-presets/active", {
    uuid,
  });
  return data;
}
