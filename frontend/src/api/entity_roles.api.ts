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
  const consolidatedPermissions = permissions.reduce<EntityRolePermissionUpdate[]>(
    (acc, permission) => {
      if (permission.type === "prompt" && permission.templates) {
        const existing = acc.find(
          (p) =>
            p.uuid === permission.uuid &&
            p.type === "prompt" &&
            p.category === permission.category,
        );

        if (!existing) {
          acc.push({
            ...permission,
            access: permission.access || "no-access",
          });
          return acc;
        }

        const existingTemplates = existing.templates;
        if (existingTemplates) {
          for (const newTemplate of permission.templates) {
            const existingTemplate = existingTemplates.find(
              (t) => t.templateId === newTemplate.templateId,
            );

            if (!existingTemplate) {
              existingTemplates.push({
                ...newTemplate,
                access: newTemplate.access || "no-access",
              });
              continue;
            }

            existingTemplate.access = existingTemplate.access || "no-access";

            const existingPrompts = existingTemplate.prompts ?? [];
            existingTemplate.prompts = existingPrompts;
            for (const newPrompt of newTemplate.prompts ?? []) {
              if (!existingPrompts.some((p) => p.promptId === newPrompt.promptId)) {
                existingPrompts.push({
                  ...newPrompt,
                  access: newPrompt.access || "no-access",
                });
              }
            }
          }
        } else {
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

        existing.access = existing.access || "no-access";
        return acc;
      }

      const alreadyAdded = acc.some(
        (p) =>
          p.uuid === permission.uuid &&
          p.type === permission.type &&
          p.category === permission.category,
      );

      if (!alreadyAdded) {
        acc.push({
          ...permission,
          access: permission.access || "no-access",
        });
      }

      return acc;
    },
    [],
  );

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

  const activityLog = data.map((log) => {
    const resource = ROLE_RESOURCE_LABELS[log.resource_type] ?? log.resource_type;
    const activityType = `${log.action.charAt(0).toUpperCase()}${log.action.slice(1)} ${resource}`;
    return {
      uuid: log.uuid,
      role: log.role_name,
      performedBy: log.performed_by_email,
      activityType,
      timestamp: new Date(log.created_at).getTime(),
      detailsMsg: log.details_msg ?? "",
      details: log.details,
    } satisfies ActivityLogEntry;
  });

  return activityLog;
}

export type RoleAccessList = Record<string, string>[];

export type UserPermissions = {
  data_connectors: {
    uuid: string | null;
    type: "backend" | "file";
    name: string | null;
    description?: string | null;
    access: RoleAccessList;
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
