import { vi } from "vitest";
import type { GroupTypeT, WidgetContextType, WidgetT } from "~/components/types";
import { type UserAccess, useAccessStore } from "~/lib/state/access";
import { type Item, type Items, type TabData, useAppStore } from "~/lib/state/app";
import type { AuthState } from "~/lib/state/auth";
import type { MessageGroup } from "~/lib/state/copilot";
import type { User } from "~/types/user.type";

export const makeTabData = (overrides: Partial<TabData> = {}): TabData => ({
  name: "Test Dashboard",
  widgets: [],
  groups: [],
  ...overrides,
});

export const makeItem = (
  overrides: Partial<Omit<Item, "data">> & { index: string; data?: Partial<TabData> },
): Item => {
  const { data, ...rest } = overrides;
  return { children: [], ...rest, data: makeTabData(data) };
};

export function appItems(): Items {
  const { items } = useAppStore.getState();
  if (!items) throw new Error("The app store has no dashboards loaded");
  return items;
}

export const makeWidget = (overrides: Partial<WidgetT> = {}): WidgetT => ({
  id: "test-widget",
  name: "Test Widget",
  type: "custom",
  widgetId: "test-widget-id",
  storage: { params: {} },
  data: {},
  ...overrides,
});

export const makeWidgetContext = (
  widget: WidgetT,
  overrides: Partial<WidgetContextType> = {},
): WidgetContextType => ({
  widget,
  widgetRef: { current: widget },
  widgetFromJSON: null,
  activeDashboardId: "test-dashboard",
  isShared: false,
  isPreview: false,
  uuid: "test-uuid",
  updateWidget: vi.fn(),
  getWidget: () => widget,
  ...overrides,
});

export function nthLastCall<A extends unknown[]>(
  mock: { mock: { calls: A[] } },
  n = 1,
): A {
  const call = mock.mock.calls.at(-n);
  if (!call) throw new Error(`The mock has been called fewer than ${n} times`);
  return call;
}

export const makeParamGroup = (
  overrides: Partial<GroupTypeT<"param">> & { id: string; groupById: string },
): GroupTypeT<"param"> => ({
  type: "param",
  name: "Group",
  color: "#00AAFF",
  value: null,
  ...overrides,
});

export const makeEndpointParamGroup = (
  overrides: Partial<GroupTypeT<"endpointParam">> & { id: string; groupById: string },
): GroupTypeT<"endpointParam"> => ({
  type: "endpointParam",
  name: "Group",
  color: "#00AAFF",
  value: null,
  ...overrides,
});

export const makeMessageGroup = (
  overrides: Partial<MessageGroup> = {},
): MessageGroup => ({
  role: "ai",
  messages: [],
  senderId: "sender",
  ...overrides,
});

type AuthUser = NonNullable<AuthState["user"]>;

export const makeAuthUser = (overrides: Partial<AuthUser> = {}): AuthUser => ({
  email: "test@example.com",
  entity_name: null,
  role: null,
  uuid: "auth-user-uuid",
  ...overrides,
});

export const makeAccess = (overrides: Partial<UserAccess> = {}): UserAccess => ({
  user_type: "User",
  sharing: "none",
  ...overrides,
});

export function setAccess(overrides: Partial<UserAccess> = {}) {
  useAccessStore.setState({ access: makeAccess(overrides) });
}

export const makeUser = (overrides: Partial<User> = {}): User => ({
  uuid: "user-uuid",
  first_name: "Test",
  last_name: "User",
  email: "test@example.com",
  role: "User",
  status: "active",
  last_login: null,
  last_active: null,
  permissions_uuid: "permissions-uuid",
  source: "user",
  ...overrides,
});
