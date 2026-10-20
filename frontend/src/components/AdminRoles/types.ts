import type { ReactNode } from "react";
import type { EntityRolePermissions } from "~/api/entity_roles.api";
import type { SharingLevel } from "~/lib/state/access";

/** What a role lets its members do besides the resources it grants. A null limit is no limit. */
export interface RoleSettings {
  sharing: SharingLevel;
  copilot_calls_day: number | null;
  copilot_tokens_day: number | null;
  upload_size_gb: number | null;
  /** The Copilot's tools for the web: on for a user when any of their roles allows them. */
  search_web: boolean;
  fetch_from_web: boolean;
}

export interface RoleT extends RoleSettings {
  uuid: string;
  name: string;
  description: string;
  users: string[]; // email addresses of users in the group
  createdAt: number;
}

export type RolesContextType = {
  roles: RoleT[];
  setRoles: (roles: RoleT[]) => void;
  selectedRoles: Set<string>;
  setSelectedRoles: (selected: Set<string>) => void;
};

export type ActivityLogEntry = {
  uuid: string;
  role: string;
  performedBy: string;
  activityType: string;
  timestamp: number;
  detailsMsg: string;
  details: Record<string, unknown>;
};

export type RoleAuditAction =
  | "create"
  | "update"
  | "delete"
  | "restore"
  | "assign"
  | "remove"
  | "add";

export type RoleResourceType = "role" | "backend" | "file" | "prompt" | "user";

export type RoleAuditLogReturn = {
  uuid: string;
  created_at: string;
  entity_uuid: string;
  role_uuid: string | null;
  action: RoleAuditAction;
  resource_type: RoleResourceType;
  resource_uuid: string;
  performed_by_email: string;
  details: Record<string, unknown>;
  role_name: string;
  details_msg: string | null;
};

export interface PermissionItem {
  uuid: string;
  name: string;
  description?: string;
  category?: "backend" | "file" | "prompt" | "template";
  /** Unset until the role's saved permissions are applied */
  access?: "no-access" | "access";
  isChecked?: boolean;
  status?: "success" | "error";
  widgets?: PermissionItem[];
  templates?: PermissionItem[];
  appWidgetsIds?: string[];
  isOpen?: boolean;
  parentBackend?: string;
  parentUuid?: string;
  parentTemplate?: string;
  parentAccess?: "access" | "no-access";
}

export interface EditPermissionsDialogProps {
  open: boolean;
  setOpen: (value: boolean) => void;
  role: RoleT | null;
  permissions: EntityRolePermissions[];
  /** Optional control rendered in the dialog header to switch the active role. When set, the title becomes "Setup Permissions". */
  roleSelector?: ReactNode;
}

export const PERMISSION_TABS = [
  {
    value: "templates",
    label: "Apps",
    icon: "dashboard-icon",
  },
  {
    value: "data-connectors",
    label: "Widgets",
    icon: "data-connectors-icon",
  },
  {
    value: "prompts",
    label: "Prompt Library",
    icon: "message-text-square-02",
  },
] as const;

export type PossibleTabValues = (typeof PERMISSION_TABS)[number]["value"];
