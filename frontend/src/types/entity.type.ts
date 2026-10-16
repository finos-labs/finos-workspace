import type { UserType } from "~/lib/state/access";

/** The user types, in the order they are offered. */
export const USER_TYPES = [
  "Admin",
  "Developer",
  "User",
] as const satisfies readonly UserType[];

export interface EntityType {
  uuid: string;
  entity_type: string;
  code: string;
  active: boolean;
  permission_hierarchy: number;
}

export interface Entity {
  uuid: string;
  name: string;
  entity_type: EntityType;
  email: string | null;
  company_type: string | null;
  country: string | null;
  aum: number | null;
  organization_size: string | null;
  /** Whether the roles of this organization may let its users share and receive items. */
  sharing_enabled: boolean;
}

export interface EntityMapItem {
  uuid: string;
  /** The user type of the users placed in this map. */
  name: UserType;
  entity_uuid: string;
  entity: Entity;
}

export interface EntitySettings {
  require_authenticator: boolean;
}
