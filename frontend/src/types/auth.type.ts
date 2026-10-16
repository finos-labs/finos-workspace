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

export type DefaultSkillSlugs = "html-report" | "html-table" | "html-chart";

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
  removedSkillSlugs?: DefaultSkillSlugs[]; // Track removed skills by slug to prevent re-adding default skills
}

export type SyncType = "owned" | "shared" | "entity_shared";
export type SharedType = "shared" | "entity_shared";

export interface DashSyncT {
  owned?: Record<string, SharedItem>;
  shared?: Record<string, SharedItem>;
  entity_shared?: Record<string, SharedItem>;
  entity_theme_settings: EntityThemeSettings;
  access?: UserAccess;
  can_submit_marketplace?: boolean;
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
  can_submit_marketplace: boolean;
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

/**
 * A sign-in the API answered with HTTP 202: the code from the user's authenticator is
 * missing or wrong, or (`two_factor_required`) their organization requires an
 * authenticator they have not set up yet. In that case the API also set the short-lived
 * enrollment cookie that POST /totp and POST /totp/activate accept.
 */
export type Login2FAResponse = Detail & { two_factor_required?: boolean };

/** GET /app/session: who is signed in, restored from the session cookie after a reload. */
export type SessionResponse = Pick<
  LoginResponse,
  "uuid" | "email" | "entity_name" | "role" | "access"
> &
  Partial<
    Pick<LoginResponse, "can_submit_marketplace" | "usage" | "temporary_password">
  > & {
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
}

/**
 * Lightweight skill entry sent with every query to the AI.
 * Contains only the metadata needed for the model to decide if it needs the full content.
 */
export interface SkillCatalogEntry {
  slug: string;
  description: string;
  updatedAt: string;
}

/**
 * Full skill payload sent when user forces via /slug or model requests via function call.
 */
export interface SkillPayload {
  slug: string;
  description: string;
  contentMarkdown: string;
  source: "forced_slash" | "model_selected";
}
