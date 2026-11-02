import type { CustomCopilot } from "~/api/auth.api";
import type { WidgetT } from "~/components/types";
import type { Usage, UserAccess } from "~/lib/state/access";
import type {
  Source,
  StoredFile,
  WidgetMetadataItem,
} from "~/lib/state/backendConnector";
import type { Chat } from "~/lib/state/copilot";
import type { CopilotAccess } from "~/lib/state/copilotAccess";
import type { EntityThemeSettings } from "~/lib/state/entityTheme";
import type { McpServer } from "~/lib/state/mcpTools";
import type { SharedItem } from "~/lib/state/sharedApp";
import type { UserAppsSync } from "~/lib/state/userApps";

export interface DisplaySettings {
  theme: "light" | "dark";
  showWidgetControlsEllipsis: boolean;
  aiEnhancements: boolean;
  fontSize: "medium" | "large";
  gridCorners: Array<"ne" | "nw" | "se" | "sw">;
  gridSnapping: "off" | "vertical";
  quickAddButtonVisible: boolean;
  showMinimizeButton: boolean;
  lastVisitedPage?: string;
  collapsedPanelExpandOnHover?: boolean;
  autoHideWidgetNavbar?: boolean;
}

export type SyncType = "owned" | "shared" | "entity_shared";
export type SharedType = "shared" | "entity_shared";

export interface DashSyncT {
  owned?: Record<string, SharedItem>;
  shared?: Record<string, SharedItem>;
  entity_shared?: Record<string, SharedItem>;
  entity_theme_settings: EntityThemeSettings;
  access?: UserAccess;
  usage?: Usage;
  copilot_chats?: Chat[];
  questions_history?: string[];
  display_settings?: DisplaySettings;
  file_widgets: StoredFile[];
  widget_metadata: WidgetMetadataItem[];
  user_apps?: UserAppsSync;
  user_skills?: Skill[];
  mcp_servers?: McpServer[];
  copilot_access?: CopilotAccess;
}

export type DashSync<T extends SyncType = SyncType> = T extends SyncType
  ? DashSyncT[T]
  : never;

export type DashShared = {
  shared: DashSync<"shared">;
  entity_shared: DashSync<"entity_shared">;
};

export type Detail = { status: number; detail: string };
export interface LoginResponse {
  is_first_login: boolean;
  custom_copilots: CustomCopilot[];
  access: UserAccess;
  usage: Usage;
  uuid: string;
  email: string;
  expiration_date: string;
  temporary_password: boolean;
  force_2fa: boolean;
  entity_name: null | string;
  entity_theme_settings: EntityThemeSettings;
  role: null | string;
  show_changelog: boolean;
  status?: number;
  detail?: string;
  user: UserResponse;
  dash_sync: DashSyncT;
  user_apps: UserAppsSync;
  user_skills: Skill[];
  copilot_chats: Chat[];
  questions_history: string[];
  mcp_servers: McpServer[];
}

export type Login2FAResponse = Detail & { two_factor_required?: boolean };

export type SessionResponse = Pick<
  LoginResponse,
  "uuid" | "email" | "entity_name" | "role" | "access"
> &
  Partial<Pick<LoginResponse, "usage" | "temporary_password">> & {
    user: Pick<UserResponse, "first_name" | "last_name" | "display_settings">;
  };

export interface SuccessReturn {
  success: boolean;
  message?: string;
}

export interface UserResponse {
  expiration_date: string;
  first_name: null | string;
  last_name: null | string;
  display_settings: DisplaySettings;
  api_sources: Source[];
  file_widgets: StoredFile[];
  user_apps: UserAppsSync;
  widget_metadata: WidgetMetadataItem[];
}

export function isLoggedIn(
  response: LoginResponse | Login2FAResponse,
): response is LoginResponse {
  return "uuid" in response && response.uuid !== undefined && response.status === 200;
}

export type MetaDataWidgetType = "iframe" | "html";

export type WidgetMetadataResponse = {
  widgetId: string;
  widgetType?: MetaDataWidgetType;
  name: string;
  description?: string | null;
  source?: string | null;
  category?: string | null;
  subCategory?: string | null;
  storage?: Record<string, unknown>;
  widgetConfig?: Partial<WidgetT>;
};

export interface HTTPValidationError {
  detail: {
    loc: (string | number)[];
    msg: string;
    type: string;
  }[];
}

export interface Prompt {
  id: string;
  prompt: string;
  widgets?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SkillCreate {
  slug: string;
  description: string;
  content: string;
}

export interface Skill extends SkillCreate {
  id: string;
  createdDate: string;
  updatedDate: string;
  pluginName?: string | null;
}

export interface SkillCatalogEntry {
  slug: string;
  description: string;
  updatedAt: string;
}

export interface SkillPayload {
  slug: string;
  description: string;
  contentMarkdown?: string;
  source: "forced_slash" | "model_selected";
}
