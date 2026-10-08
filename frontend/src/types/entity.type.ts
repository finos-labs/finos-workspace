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
  seats: number | null;
  expiration_date: string | null;
}

export interface EntityMapItem {
  uuid: string;
  /** Name of the user role */
  name: string;
  entity_uuid: string;
  entity: Entity;
}

export interface EntitySettings {
  require_authenticator: boolean;
}
