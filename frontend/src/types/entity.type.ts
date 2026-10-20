import type { UserType } from "~/lib/state/access";

/** The user types, in the order they are offered. */
export const USER_TYPES = [
  "Admin",
  "Developer",
  "User",
] as const satisfies readonly UserType[];

/** An organization: its name, and whether its roles may let its users share. */
export interface Entity {
  uuid: string;
  name: string;
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

/** A user as a superuser's list of every user has them. */
export interface EntityUser {
  uuid: string;
  email: string;
  /** Their user type and its entity; none for a user removed from their organization. */
  permissions: EntityMapItem | null;
}

export interface EntitySettings {
  require_authenticator: boolean;
}
