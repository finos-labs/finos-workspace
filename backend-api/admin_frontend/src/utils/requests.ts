/** The account signed in to the admin panel, as GET /session reports it. */
export interface User {
  email: string;
  is_superuser: boolean;
}

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
  email: string | null;
  company_type: string | null;
  organization_size: string | null;
  aum: number | null;
  country: string | null;
  entity_type: EntityType;
  sharing_enabled: boolean;
}

export interface EntityRelationship {
  uuid: string;
  child: Entity;
  parent: Entity;
  supreme: Entity;
}

/** The user types; a permissions map is named after one of them. */
export const USER_TYPES = ["Admin", "Developer", "User"] as const;
export type UserType = (typeof USER_TYPES)[number];

export interface PermissionMap {
  uuid: string;
  entity: Entity;
  name: UserType;
}

export interface FullUser {
  uuid: string;
  email: string;
  permissions: PermissionMap | null;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pages: number;
  total: number;
  size: number;
}

export interface AddResponse {
  message?: string;
  success: boolean;
}

export interface AddResponseData<T> extends AddResponse {
  data?: T;
}

export interface ListResponse<T> {
  data?: Paginated<T>;
  message?: string;
}

export interface BaseEntity {
  name: string;
  entity_code: string;
  email: string;
  company_type: string;
  organization_size: string;
  aum: number;
  country: string;
  sharing_enabled: boolean;
}

export interface PostEntity extends BaseEntity {
  admin_email: string;
}

const baseUrl = import.meta.env.VITE_API_URL;

/**
 * The admin panel's session lives in the API's HttpOnly `__Host-ws_admin` cookie, which no
 * script can read; the panel holds no token. This header tells the API to read that cookie.
 */
const ADMIN_CLIENT_HEADER = { "X-Workspace-Client": "admin" } as const;

const baseHeaders = {
  Accept: "application/json",
  "Content-Type": "application/json",
  ...ADMIN_CLIENT_HEADER,
};

/** Calls the API with the admin panel's session cookie and the client header. */
function apiFetch(
  path: string,
  method: "GET" | "POST" | "PUT",
  body?: object,
): Promise<Response> {
  return fetch(`${baseUrl}/${path}`, {
    method,
    headers: baseHeaders,
    credentials: "include",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** The parsed body of a response, as the type the backend documents for it. */
async function readJson<T>(res: Response): Promise<T> {
  return res.json();
}

/** The `detail` message of an error response body, if it has one. */
function errorDetail(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const detail = Reflect.get(body, "detail");
  return typeof detail === "string" && detail !== "" ? detail : undefined;
}

/** What an answer says: its `detail`, or the `message` that some answers carry instead. */
function answerMessage(body: unknown): string | undefined {
  const detail = errorDetail(body);
  if (detail !== undefined || typeof body !== "object" || body === null) return detail;
  const message = Reflect.get(body, "message");
  return typeof message === "string" && message !== "" ? message : undefined;
}

function isUser(body: unknown): body is User {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof Reflect.get(body, "email") === "string" &&
    typeof Reflect.get(body, "is_superuser") === "boolean"
  );
}

async function prettyStatusCodes(res: Response): Promise<AddResponse> {
  if (res.status === 200) {
    return { success: true };
  }

  const failureDict: Record<number, string> = {
    422: "Invalid form data",
    404: "Item does not exist",
    400: "Invalid data sent",
    409: "Item already exists",
  };

  let message = failureDict[res.status];
  if (message === undefined) {
    message = "Unknown error occurred";
  }

  try {
    const detail = errorDetail(await res.json());
    return {
      success: false,
      message: detail ? `${message}: ${detail}` : message
    };
  } catch {
    return { success: false, message };
  }
}

async function extractData<T>(res: Response): Promise<ListResponse<T>> {
  if (res.status === 200) {
    const data = await readJson<Paginated<T>>(res);
    if (data instanceof Object) {
      return { data };
    }
  }
  return { message: "Failed to get new data" };
}

function listPath(path: string, size: number, page: number): string {
  return `${path}?size=${size}&page=${page}`;
}

/** The account the session cookie belongs to (GET /session), or null without a valid session. */
export async function fetchSession(): Promise<User | null> {
  const res = await apiFetch("session", "GET");
  if (res.status !== 200) {
    return null;
  }
  const body: unknown = await res.json();
  return isUser(body) ? { email: body.email, is_superuser: body.is_superuser } : null;
}

export interface LoginRequest {
  email: string;
  password: string;
  /** The authenticator's current code, sent as `totp_token` with the email and password. */
  totpToken?: number;
  remember?: boolean;
}

/** What a sign-in (POST /login) came to. */
export type LoginResult =
  | { outcome: "signed-in"; user: User }
  /** The account has an authenticator: sign in again with its code (`totpToken`). */
  | { outcome: "code-needed" }
  | { outcome: "refused"; message: string };

/** What to say for a refusal whose answer carries no message of its own. */
const LOGIN_REFUSALS: Record<number, string> = {
  401: "Credentials are incorrect",
  422: "The email, password or code sent is not valid.",
  429: "Too many sign-in attempts. Wait a minute and try again.",
};

function isTwoFactorRequired(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    Reflect.get(body, "two_factor_required") === true
  );
}

/**
 * Signs in (POST /login); the API answers by setting the session cookie. A superuser who
 * has an authenticator sends its code as `totp_token` in the same body: without a valid
 * one the API answers 202 and no session. A 202 with `two_factor_required` means the
 * organization requires an authenticator the user has not set up yet, which is done by
 * signing in to the web app. A refusal shows the API's own message.
 */
export async function apiLogin({
  email,
  password,
  totpToken,
  remember = true,
}: LoginRequest): Promise<LoginResult> {
  const res = await apiFetch("login", "POST", {
    email,
    password,
    remember,
    ...(totpToken === undefined ? {} : { totp_token: totpToken }),
  });
  if (res.status === 200) {
    const user = await fetchSession();
    if (user !== null) {
      return { outcome: "signed-in", user };
    }
    return {
      outcome: "refused",
      message:
        "Signed in, but the browser did not keep the session cookie. Serve the panel and the API from the same site.",
    };
  }
  const body: unknown = await res.json().catch(() => undefined);
  if (res.status === 202 && isTwoFactorRequired(body)) {
    const required = (answerMessage(body) ?? "Two-factor authentication is required").replace(
      /[.!?]?$/,
      ".",
    );
    return {
      outcome: "refused",
      message: `${required} Sign in to the web app to set up an authenticator, then sign in here with its code.`,
    };
  }
  if (res.status === 202) {
    return totpToken === undefined
      ? { outcome: "code-needed" }
      : {
          outcome: "refused",
          message: "That authenticator code is not valid. Enter the current code.",
        };
  }
  return {
    outcome: "refused",
    message: answerMessage(body) ?? LOGIN_REFUSALS[res.status] ?? "Unknown error occurred",
  };
}

/** Ends the admin panel's session (POST /logout); the API deletes it and clears the cookie. */
export async function apiLogout(): Promise<void> {
  await apiFetch("logout", "POST");
}

export async function addEntityType(
  entityType: string,
  code: string,
  permissionHierarchy: number,
): Promise<AddResponse> {
  const body = {
    entity_type: entityType,
    code,
    active: true,
    permission_hierarchy: permissionHierarchy,
  };
  const res = await apiFetch("entity/entity-type", "POST", body);
  return prettyStatusCodes(res);
}

export async function addEntity(
  data: PostEntity,
): Promise<AddResponseData<{ entity_uuid: string; permission_map_uuid: string }>> {
  const res = await apiFetch("entity/entity", "POST", data);
  if (res.status === 200) {
    const data = await readJson<{ entity_uuid: string; permission_map_uuid: string }>(res);
    return { success: true, data };
  }
  return prettyStatusCodes(res);
}

export async function addEntityRelationship(
  parent: string,
  child: string,
): Promise<AddResponse> {
  const body = {
    parent_uuid: parent,
    child_uuid: child,
  };
  const res = await apiFetch("entity/entity-relationship", "POST", body);
  return prettyStatusCodes(res);
}

export async function addPermissionMap(
  entityUUID: string,
  name: UserType,
): Promise<AddResponse> {
  const body = { entity_uuid: entityUUID, name };
  const res = await apiFetch("entity/entity-map", "POST", body);
  return prettyStatusCodes(res);
}

export async function addUser(
  email: string,
  permissionsUUID: string,
  firstName: null | string,
  lastName: null | string,
): Promise<AddResponse> {
  const body = {
    email,
    permissions_uuid: permissionsUUID,
    first_name: firstName,
    last_name: lastName,
  };
  const res = await apiFetch("entity/register-admin", "POST", body);
  return prettyStatusCodes(res);
}

export async function getEntityTypes(): Promise<ListResponse<EntityType>> {
  const res = await apiFetch(listPath("entity/entity-type", 1000, 1), "GET");
  return await extractData<EntityType>(res);
}

export async function getEntities(): Promise<ListResponse<Entity>> {
  const res = await apiFetch(listPath("entity/entity", 1000, 1), "GET");
  return await extractData<Entity>(res);
}

export async function getEntityRelationships(): Promise<ListResponse<EntityRelationship>> {
  const res = await apiFetch(listPath("entity/entity-relationship", 1000, 1), "GET");
  return await extractData<EntityRelationship>(res);
}

export async function getPermissionMaps(): Promise<ListResponse<PermissionMap>> {
  const res = await apiFetch(listPath("entity/entity-map", 1000, 1), "GET");
  return await extractData<PermissionMap>(res);
}

export async function getUsers(
  size = 50,
  page = 1,
  email?: string,
): Promise<ListResponse<FullUser>> {
  let path = listPath("entity/user", size, page);
  if (email !== undefined) {
    path += `&email=${encodeURIComponent(email)}`;
  }
  const res = await apiFetch(path, "GET");
  return await extractData<FullUser>(res);
}

export async function editEntity(
  uuid: string,
  data: BaseEntity,
): Promise<AddResponse> {
  const res = await apiFetch(`entity/entity/${uuid}`, "PUT", data);
  return prettyStatusCodes(res);
}

export async function editEntityRelationship(
  uuid: string,
  parentUUID: string,
  childUUID: string,
): Promise<AddResponse> {
  const res = await apiFetch(`entity/entity-relationship/${uuid}`, "PUT", {
    parent_uuid: parentUUID,
    child_uuid: childUUID,
  });
  return prettyStatusCodes(res);
}

export async function editEntityType(
  uuid: string,
  entityType: string,
  code: string,
  permissionHierarchy: number,
): Promise<AddResponse> {
  const res = await apiFetch(`entity/entity-type/${uuid}`, "PUT", {
    entity_type: entityType,
    code,
    permission_hierarchy: permissionHierarchy,
    active: true,
  });
  return prettyStatusCodes(res);
}

export async function editPermissionMap(
  uuid: string,
  entityUUID: string,
  name: UserType,
): Promise<AddResponse> {
  const res = await apiFetch(`entity/entity-map/${uuid}`, "PUT", {
    entity_uuid: entityUUID,
    name,
  });
  return prettyStatusCodes(res);
}

export async function editUser(
  uuid: string,
  permissionsUUID: string,
): Promise<AddResponse> {
  const res = await apiFetch(`entity/user/${uuid}`, "PUT", {
    permissions_uuid: permissionsUUID,
  });
  return prettyStatusCodes(res);
}
