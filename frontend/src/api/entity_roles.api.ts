import {
  type ActivityLogEntry,
  ROLE_RESOURCE_LABELS,
  type RoleAuditLogReturn,
  type RoleSettings,
  type RoleT,
} from "~/components/AdminRoles/types";
import type { CopilotModelGrant, McpGrant } from "~/lib/state/copilotAccess";
import { apiClient } from "./api";

interface SuccessResponse {
  success: boolean;
}
interface EntityRoleResponse extends RoleSettings {
  uuid: string;
  name: string;
  description: string;
  users: string[];
  updated_date: string;
}

export interface EntityRolePermissions {
  uuid: string;
  access: "access" | "no-access";
  category: string;
  type: string;
  widgets?: {
    widgetId: string;
    access: "access" | "no-access";
  }[];
  templates?: {
    templateId: string;
    access: "access" | "no-access";
    prompts?: {
      promptId: string;
      access: "access" | "no-access";
    }[];
  }[];
  file_extension: string | null;
}

export async function getEntityRoles(): Promise<RoleT[]> {
  const { data } = await apiClient.get<EntityRoleResponse[]>("/admin/role");
  return data.map((role) => {
    const { updated_date, ...rest } = role;
    return {
      ...rest,
      createdAt: new Date(updated_date).getTime(),
    };
  });
}
export async function postEntityRole(role: RoleT) {
  const { createdAt, ...roleWithoutCreatedAt } = role;
  const { data } = await apiClient.post<SuccessResponse>(
    "/admin/role",
    roleWithoutCreatedAt,
  );
  return data;
}
export async function patchEntityRole(role: RoleT) {
  const { createdAt, uuid, ...adjustedRole } = role;
  const { data } = await apiClient.patch<SuccessResponse>(
    `/admin/role/${uuid}`,
    adjustedRole,
  );
  return data;
}
export async function deleteEntityRole(uuid: string) {
  const { data } = await apiClient.delete<SuccessResponse>(`/admin/role/${uuid}`);
  return data;
}
export async function getEntityRolePermissions(uuid: string) {
  const { data } = await apiClient.get<EntityRolePermissions[]>(
    `/admin/role-permissions/${uuid}`,
  );

  // Group file permissions by category
  const filePermissions = data
    .filter((p) => p.type === "file")
    .reduce(
      (acc, curr) => {
        const key = curr.file_extension;
        if (!key) return acc;
        if (!acc[key]) {
          acc[key] = {
            uuid: key,
            access: curr.access,
            category: curr.category,
            type: "file",
            file_extension: key,
            widgets: [],
          };
        }
        acc[key].widgets?.push({
          widgetId: curr.uuid,
          access: curr.access,
        });
        return acc;
      },
      {} as Record<string, EntityRolePermissions>,
    );

  return [...Object.values(filePermissions), ...data.filter((p) => p.type !== "file")];
}
type Access = "access" | "no-access";

/** A permission as edited in the UI: `access` is only set where a choice was made. */
export interface EntityRolePermissionUpdate {
  uuid: string;
  access?: Access;
  category: string;
  type?: string;
  widgets?: { widgetId: string; access?: Access }[];
  templates?: {
    templateId: string;
    access?: Access;
    prompts?: { promptId: string; access?: Access }[];
  }[];
}

type PermissionTemplate = NonNullable<EntityRolePermissionUpdate["templates"]>[number];

export async function putEntityRolePermissions(
  uuid: string,
  permissions: EntityRolePermissionUpdate[],
) {
  // First, handle prompt type permissions consolidation
  const consolidatedPermissions = permissions.reduce<EntityRolePermissionUpdate[]>(
    (acc, permission) => {
      if (permission.type === "prompt" && permission.templates) {
        // Find existing prompt permission with same UUID and category
        const existing = acc.find(
          (p) =>
            p.uuid === permission.uuid &&
            p.type === "prompt" &&
            p.category === permission.category,
        );

        if (!existing) {
          // If not found, add as is
          acc.push({
            ...permission,
            access: permission.access || "no-access", // Ensure access property exists
          });
          return acc;
        }

        // If found, merge templates
        const existingTemplates = existing.templates;
        if (existingTemplates) {
          for (const newTemplate of permission.templates) {
            const existingTemplate = existingTemplates.find(
              (t) => t.templateId === newTemplate.templateId,
            );

            if (!existingTemplate) {
              // If template doesn't exist, add it with access property
              existingTemplates.push({
                ...newTemplate,
                access: newTemplate.access || "no-access",
              });
              continue;
            }

            // Merge prompts within template
            // Ensure access property exists on template
            existingTemplate.access = existingTemplate.access || "no-access";

            // Ensure both have prompts arrays before merging
            const existingPrompts = existingTemplate.prompts ?? [];
            existingTemplate.prompts = existingPrompts;
            for (const newPrompt of newTemplate.prompts ?? []) {
              // Add prompts that don't already exist
              if (!existingPrompts.some((p) => p.promptId === newPrompt.promptId)) {
                existingPrompts.push({
                  ...newPrompt,
                  access: newPrompt.access || "no-access", // Ensure access property exists
                });
              }
            }
          }
        } else {
          // If existing has no templates but new permission does
          existing.templates = permission.templates.map(
            (template): PermissionTemplate => ({
              ...template,
              access: template.access || "no-access",
              prompts: template.prompts?.map((prompt) => ({
                ...prompt,
                access: prompt.access || "no-access",
              })),
            }),
          );
        }

        // Ensure access property exists on the permission itself
        existing.access = existing.access || "no-access";
        return acc;
      }

      // For non-prompt types or those without templates
      // Check if we already have this permission (by UUID, type and category)
      const alreadyAdded = acc.some(
        (p) =>
          p.uuid === permission.uuid &&
          p.type === permission.type &&
          p.category === permission.category,
      );

      if (!alreadyAdded) {
        // If not found, add as is with access property
        acc.push({
          ...permission,
          access: permission.access || "no-access",
        });
      }
      // If found with same UUID/type/category, we keep the existing one
      // (This prevents duplicates for non-prompt permissions)

      return acc;
    },
    [],
  );

  // Then handle file permissions flattening as before
  const flattenedPermissions = consolidatedPermissions.flatMap(
    (permission): EntityRolePermissionUpdate[] => {
      if (permission.type === "file" && permission.widgets) {
        return permission.widgets.map((widget) => ({
          uuid: widget.widgetId,
          access: widget.access,
          category: permission.category,
          type: permission.type,
        }));
      }
      return [permission];
    },
  );

  const { data } = await apiClient.put<SuccessResponse>(
    `/admin/role-permissions/${uuid}`,
    flattenedPermissions,
  );
  return data;
}

export async function getEntityRoleActivityLog() {
  const { data } = await apiClient.get<RoleAuditLogReturn[]>(
    "admin/role-permissions-audit-logs",
  );

  // transform the data to ActivityLogEntry
  const activityLog = data.map((log) => {
    const resource = ROLE_RESOURCE_LABELS[log.resource_type] ?? log.resource_type;
    const activityType = `${log.action.charAt(0).toUpperCase()}${log.action.slice(1)} ${resource}`;
    return {
      uuid: log.uuid,
      role: log.role_name,
      performedBy: log.performed_by_email,
      activityType,
      timestamp: new Date(log.created_at).getTime(), // Convert to number timestamp
      detailsMsg: log.details_msg ?? "", // Ensure string
      details: log.details,
    } satisfies ActivityLogEntry;
  });

  return activityLog;
}

/** The roles a resource is granted to: one `{ role name: access }` entry per role. */
export type RoleAccessList = Record<string, string>[];

export type UserPermissions = {
  data_connectors: {
    uuid: string | null;
    type: "backend" | "file";
    name: string | null;
    description?: string | null;
    access: RoleAccessList;
    /** Only the widgets of a backend. */
    widgets?: { widgetId: string | null; access: RoleAccessList }[];
  }[];
  templates: { templateId: string | null; access: RoleAccessList }[];
  prompts: {
    uuid: string | null;
    prompt: string | null;
    access: RoleAccessList;
    templateId?: string;
  }[];
};

type UserPermissionsResponse = UserPermissions | UserPermissions[];

export async function getUserPermissions(userUuid: string) {
  const { data } = await apiClient.get<UserPermissionsResponse>(
    `/admin/user-permissions/${userUuid}`,
  );
  return data;
}

/** The Copilot models and MCP tools that a role grants. */
export interface RoleCopilotAccess {
  models: CopilotModelGrant[];
  mcp: McpGrant[];
}

export async function getRoleCopilotAccess(roleUuid: string) {
  const { data } = await apiClient.get<RoleCopilotAccess>(
    `/admin/role/${roleUuid}/copilot-access`,
  );
  return data;
}

export async function putRoleCopilotAccess(
  roleUuid: string,
  access: RoleCopilotAccess,
) {
  const { data } = await apiClient.put<SuccessResponse>(
    `/admin/role/${roleUuid}/copilot-access`,
    access,
  );
  return data;
}
