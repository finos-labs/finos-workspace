export type UserSources = "user" | "invite";

export interface User {
  uuid: string;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  billing_active: boolean;
  status: string;
  last_login: null | string;
  last_active: null | string;
  permissions_uuid: string;
  source: UserSources;
}

export interface CreateUserDTO {
  first_name?: string;
  last_name?: string;
  email?: string;
  permissions_uuid?: string;
  role?: string | null;
  bypass_invitation?: boolean;
}
