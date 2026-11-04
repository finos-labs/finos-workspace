import type { UserType } from "~/lib/state/access";

export const USER_TYPES = [
  "Admin",
  "Developer",
  "User",
] as const satisfies readonly UserType[];

export interface Entity {
  uuid: string;
  name: string;
  sharing_enabled: boolean;
}

export interface EntityMapItem {
  uuid: string;
  name: UserType;
  entity_uuid: string;
  entity: Entity;
}

export interface EntityUser {
  uuid: string;
  email: string;
  permissions: EntityMapItem | null;
}

export interface EntitySettings {
  require_authenticator: boolean;
}
