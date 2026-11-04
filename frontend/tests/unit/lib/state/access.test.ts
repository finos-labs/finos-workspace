import { afterEach, describe, expect, it } from "vitest";
import {
  canAddConnections,
  canReceiveShares,
  canShare,
  type SharingLevel,
  type Usage,
  type UserType,
  useAccessStore,
} from "~/lib/state/access";
import { makeAccess as access } from "../../factories";

const usage = (overrides: Partial<Usage> = {}): Usage => ({
  number_copilot_calls_day_count: 3,
  number_copilot_tokens_day_count: 0,
  total_file_upload_size_gb_count: 1,
  copilot_calls_limit: 10,
  copilot_tokens_limit: null,
  file_upload_size_limit: 5,
  ...overrides,
});

describe("canAddConnections", () => {
  it.each<[UserType | null, boolean]>([
    ["Admin", true],
    ["Developer", true],
    ["User", false],
    [null, false],
  ])("is %s -> %s", (userType, expected) => {
    expect(canAddConnections(access({ user_type: userType }))).toBe(expected);
  });

  it("is false before the access is loaded", () => {
    expect(canAddConnections(null)).toBe(false);
  });
});

describe("sharing levels", () => {
  it.each<[SharingLevel, boolean, boolean]>([
    ["none", false, false],
    ["receive", false, true],
    ["share", true, true],
  ])("%s: share %s, receive %s", (sharing, share, receive) => {
    expect(canShare(access({ sharing }))).toBe(share);
    expect(canReceiveShares(access({ sharing }))).toBe(receive);
  });

  it("allows neither before the access is loaded", () => {
    expect(canShare(null)).toBe(false);
    expect(canReceiveShares(null)).toBe(false);
  });
});

describe("useAccessStore", () => {
  afterEach(() => {
    useAccessStore.setState({ access: null, usage: null });
  });

  it("starts with nothing granted", () => {
    const state = useAccessStore.getState();
    expect(state.access).toBeNull();
    expect(state.usage).toBeNull();
  });

  it("replaces the access", () => {
    useAccessStore.getState().setAccess(access({ sharing: "share" }));
    useAccessStore.getState().setAccess(access({ user_type: "Admin" }));

    expect(useAccessStore.getState().access).toEqual(access({ user_type: "Admin" }));
  });

  it("sets access and usage together", () => {
    useAccessStore
      .getState()
      .setAccessAndUsage(access({ sharing: "receive" }), usage());

    const state = useAccessStore.getState();
    expect(state.access?.sharing).toBe("receive");
    expect(state.usage).toEqual(usage());
  });

  it("merges a partial usage update into the current usage", () => {
    useAccessStore.setState({ usage: usage() });

    useAccessStore.getState().setUsage({ number_copilot_calls_day_count: 4 });

    expect(useAccessStore.getState().usage).toEqual(
      usage({ number_copilot_calls_day_count: 4 }),
    );
  });
});
