import { vi } from "vitest";
import type {
  GroupTypeT,
  Ticker,
  WidgetContextType,
  WidgetT,
} from "~/components/types";
import { type UserAccess, useAccessStore } from "~/lib/state/access";
import { type Item, type Items, type TabData, useAppStore } from "~/lib/state/app";
import type { AuthState } from "~/lib/state/auth";
import type { MessageGroup } from "~/lib/state/copilot";
import type { User } from "~/types/user.type";

/** A dashboard's data, with an empty dashboard for whatever is not given. */
export const makeTabData = (overrides: Partial<TabData> = {}): TabData => ({
  name: "Test Dashboard",
  widgets: [],
  groups: [],
  ...overrides,
});

/** A dashboard or folder item, with no children for whatever is not given. */
export const makeItem = (
  overrides: Partial<Omit<Item, "data">> & { index: string; data?: Partial<TabData> },
): Item => {
  const { data, ...rest } = overrides;
  return { children: [], ...rest, data: makeTabData(data) };
};

/** The dashboards in the app store, which a test has loaded before it reads them. */
export function appItems(): Items {
  const { items } = useAppStore.getState();
  if (!items) throw new Error("The app store has no dashboards loaded");
  return items;
}

/** A widget as a dashboard holds it; only the fields a test names differ from the default. */
export const makeWidget = (overrides: Partial<WidgetT> = {}): WidgetT => ({
  id: "test-widget",
  name: "Test Widget",
  type: "custom",
  widgetId: "test-widget-id",
  storage: { params: {} },
  data: {},
  ...overrides,
});

/** A widget context for a widget on a dashboard; updates are recorded on a mock. */
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

/** The arguments of the n-th latest call to a mock (1 is the latest); a test that reads one expects it to exist. */
export function nthLastCall<A extends unknown[]>(
  mock: { mock: { calls: A[] } },
  n = 1,
): A {
  const call = mock.mock.calls.at(-n);
  if (!call) throw new Error(`The mock has been called fewer than ${n} times`);
  return call;
}

/** A ticker, a US stock named after its symbol for whatever is not given. */
export const makeTicker = (overrides: Partial<Ticker> = {}): Ticker => ({
  id: overrides.symbol ?? "AAPL",
  symbol: "AAPL",
  category: "equity",
  type: "stock",
  ...overrides,
});

/** A dashboard group of widgets sharing a ticker, with the ticker given. */
export const makeTickerGroup = (
  overrides: Partial<GroupTypeT<"ticker">> & { id: string },
): GroupTypeT<"ticker"> => ({
  type: "ticker",
  name: "Group",
  color: "#00AAFF",
  groupById: undefined,
  value: makeTicker(),
  ...overrides,
});

/** A dashboard group for a widget parameter, with no value picked yet. */
export const makeParamGroup = (
  overrides: Partial<GroupTypeT<"param">> & { id: string; groupById: string },
): GroupTypeT<"param"> => ({
  type: "param",
  name: "Group",
  color: "#00AAFF",
  value: null,
  ...overrides,
});

/** A dashboard group for an endpoint parameter, with no value picked yet. */
export const makeEndpointParamGroup = (
  overrides: Partial<GroupTypeT<"endpointParam">> & { id: string; groupById: string },
): GroupTypeT<"endpointParam"> => ({
  type: "endpointParam",
  name: "Group",
  color: "#00AAFF",
  value: null,
  ...overrides,
});

/** A conversation group of messages from one sender. */
export const makeMessageGroup = (
  overrides: Partial<MessageGroup> = {},
): MessageGroup => ({
  role: "ai",
  messages: [],
  senderId: "sender",
  ...overrides,
});

type AuthUser = NonNullable<AuthState["user"]>;

/** The user who is logged in, for whatever is not given. */
export const makeAuthUser = (overrides: Partial<AuthUser> = {}): AuthUser => ({
  email: "test@example.com",
  entity_name: null,
  role: null,
  uuid: "auth-user-uuid",
  ...overrides,
});

/** What the user's roles let them do; a User granted nothing for whatever is not given. */
export const makeAccess = (overrides: Partial<UserAccess> = {}): UserAccess => ({
  user_type: "User",
  sharing: "none",
  ...overrides,
});

/** Gives the signed-in user the access that their roles would. */
export function setAccess(overrides: Partial<UserAccess> = {}) {
  useAccessStore.setState({ access: makeAccess(overrides) });
}

/** An entity user, signed up, for whatever is not given. */
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
