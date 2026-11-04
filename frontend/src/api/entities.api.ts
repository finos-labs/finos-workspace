import type { UserType } from "~/lib/state/access";
import type { Entity, EntityMapItem, EntityUser } from "~/types/entity.type";
import { apiClient } from "./api";

interface Page<T> {
  items: T[];
  page: number;
  pages: number;
  total: number;
  size: number;
}

interface SuccessResponse {
  success: boolean;
}

export interface EntityBody {
  name: string;
  sharing_enabled: boolean;
}

interface EntityAdminBody {
  email: string;
  permissions_uuid: string;
  first_name: string;
  last_name: string;
}

const PAGE_SIZE = 1000;

async function getAllPages<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  let page = 1;
  let pages = 1;
  do {
    const { data } = await apiClient.get<Page<T>>(path, {
      params: { size: PAGE_SIZE, page },
    });
    items.push(...data.items);
    pages = data.pages;
    page += 1;
  } while (page <= pages);
  return items;
}

export async function validateEntityAdmin() {
  const { data } = await apiClient.get<SuccessResponse>("/entity/validate");
  return data;
}

export const getEntities = () => getAllPages<Entity>("/entity/entity");
export const getEntityMaps = () => getAllPages<EntityMapItem>("/entity/entity-map");
export const getEntityUsers = () => getAllPages<EntityUser>("/entity/user");

export async function moveEntityUser(uuid: string, permissionsUuid: string) {
  const { data } = await apiClient.put<SuccessResponse>(`/entity/user/${uuid}`, {
    permissions_uuid: permissionsUuid,
  });
  return data;
}

export async function createEntity(body: EntityBody & { admin_email: string }) {
  const { data } = await apiClient.post<{
    entity_uuid: string;
    permission_map_uuid: string;
  }>("/entity/entity", body);
  return data;
}

export async function updateEntity(uuid: string, body: EntityBody) {
  const { data } = await apiClient.put<SuccessResponse>(`/entity/entity/${uuid}`, body);
  return data;
}

export async function registerEntityAdmin(body: EntityAdminBody) {
  const { data } = await apiClient.post<SuccessResponse>(
    "/entity/register-admin",
    body,
  );
  return data;
}

export async function createEntityMap(entityUuid: string, name: UserType) {
  const { data } = await apiClient.post<{ uuid: string }>("/entity/entity-map", {
    entity_uuid: entityUuid,
    name,
  });
  return data;
}

export async function updateEntityMap(
  uuid: string,
  entityUuid: string,
  name: UserType,
) {
  const { data } = await apiClient.put<SuccessResponse>(`/entity/entity-map/${uuid}`, {
    entity_uuid: entityUuid,
    name,
  });
  return data;
}
