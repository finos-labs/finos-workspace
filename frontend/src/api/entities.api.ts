import type { UserType } from "~/lib/state/access";
import type {
  Entity,
  EntityMapItem,
  EntityType,
  EntityUser,
} from "~/types/entity.type";
import { apiClient } from "./api";

/** What the entity endpoints answer lists with. */
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

export interface EntityRelationship {
  uuid: string;
  parent: Entity;
  child: Entity;
  supreme: Entity;
}

/** The fields that make an entity, as the backend takes them. */
export interface EntityBody {
  name: string;
  entity_code: string;
  email: string;
  company_type: string;
  organization_size: string;
  aum: number;
  country: string;
  sharing_enabled: boolean;
}

export interface EntityTypeBody {
  entity_type: string;
  code: string;
  active: boolean;
  permission_hierarchy: number;
}

export interface EntityAdminBody {
  email: string;
  permissions_uuid: string;
  first_name: string;
  last_name: string;
}

const PAGE_SIZE = 1000;

/** Every item of a paginated list. */
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

/** Succeeds for a superuser, who manages entities; anyone else is refused. */
export async function validateEntityAdmin() {
  const { data } = await apiClient.get<SuccessResponse>("/entity/validate");
  return data;
}

export const getEntityTypes = () => getAllPages<EntityType>("/entity/entity-type");
export const getEntities = () => getAllPages<Entity>("/entity/entity");
export const getEntityRelationships = () =>
  getAllPages<EntityRelationship>("/entity/entity-relationship");
export const getEntityMaps = () => getAllPages<EntityMapItem>("/entity/entity-map");
/** Every user of every entity, but the deleted ones. */
export const getEntityUsers = () => getAllPages<EntityUser>("/entity/user");

/** Moves the user to the permission map: a user type of an entity. */
export async function moveEntityUser(uuid: string, permissionsUuid: string) {
  const { data } = await apiClient.put<SuccessResponse>(`/entity/user/${uuid}`, {
    permissions_uuid: permissionsUuid,
  });
  return data;
}

export async function createEntityType(body: EntityTypeBody) {
  const { data } = await apiClient.post<SuccessResponse>("/entity/entity-type", body);
  return data;
}

export async function updateEntityType(uuid: string, body: EntityTypeBody) {
  const { data } = await apiClient.put<SuccessResponse>(
    `/entity/entity-type/${uuid}`,
    body,
  );
  return data;
}

/** The entity, with the permission map that its administrator is placed in. */
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

export async function createEntityRelationship(parentUuid: string, childUuid: string) {
  const { data } = await apiClient.post<{ uuid: string }>(
    "/entity/entity-relationship",
    {
      parent_uuid: parentUuid,
      child_uuid: childUuid,
    },
  );
  return data;
}

export async function updateEntityRelationship(
  uuid: string,
  parentUuid: string,
  childUuid: string,
) {
  const { data } = await apiClient.put<SuccessResponse>(
    `/entity/entity-relationship/${uuid}`,
    { parent_uuid: parentUuid, child_uuid: childUuid },
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
