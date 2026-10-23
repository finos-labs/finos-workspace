import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useGlobalTitleManager from "~/hooks/useTitle";

const mockUseLocation = vi.fn();
const mockUseMatches = vi.fn();
vi.mock("react-router-dom", () => ({
  useLocation: () => mockUseLocation(),
  useMatches: () => mockUseMatches(),
}));

const mockGetConfig = vi.fn();
vi.mock("~/lib/runtimeConfig", () => ({
  getConfig: () => mockGetConfig(),
}));

const mockUseShallowAppStore = vi.fn();
vi.mock("~/lib/state/app", () => ({
  useShallowAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    mockUseShallowAppStore(selector),
}));

const mockUseShallowSharedAppStore = vi.fn();
vi.mock("~/lib/state/sharedApp", () => ({
  useShallowSharedAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    mockUseShallowSharedAppStore(selector),
}));

describe("useGlobalTitleManager", () => {
  const originalTitle = document.title;

  beforeEach(() => {
    vi.clearAllMocks();
    document.title = "Initial Title";

    mockGetConfig.mockReturnValue({
      whiteLabel: {
        name: undefined,
      },
    });

    mockUseLocation.mockReturnValue({ pathname: "/" });
    mockUseMatches.mockReturnValue([]);

    mockUseShallowAppStore.mockImplementation((selector) => selector({}));
    mockUseShallowSharedAppStore.mockImplementation((selector) => selector({}));
  });

  afterEach(() => {
    document.title = originalTitle;
  });

  it("should set default brand name when path is root", () => {
    mockUseLocation.mockReturnValue({ pathname: "/" });

    renderHook(() => useGlobalTitleManager());

    expect(document.title).toBe("Workspace");
  });

  it("should set custom brand name when path is root and white label name is configured", () => {
    mockUseLocation.mockReturnValue({ pathname: "/" });
    mockGetConfig.mockReturnValue({
      whiteLabel: {
        name: "My custom brand",
      },
    });

    renderHook(() => useGlobalTitleManager());

    expect(document.title).toBe("My custom brand");
  });

  it("should format static page titles correctly", () => {
    mockUseLocation.mockReturnValue({ pathname: "/login" });

    renderHook(() => useGlobalTitleManager());

    expect(document.title).toBe("Login | Workspace");
  });

  it("titles the page of a password reset link", () => {
    mockUseLocation.mockReturnValue({ pathname: "/reset-password" });

    renderHook(() => useGlobalTitleManager());

    expect(document.title).toBe("Set a new password | Workspace");
  });

  it("should respect custom brand name in static page titles", () => {
    mockUseLocation.mockReturnValue({ pathname: "/app/settings" });
    mockGetConfig.mockReturnValue({
      whiteLabel: {
        name: "Custom Enterprise",
      },
    });

    renderHook(() => useGlobalTitleManager());

    expect(document.title).toBe("Settings | Custom Enterprise");
  });

  it("should resolve dynamic tab titles from standard app store", () => {
    mockUseLocation.mockReturnValue({ pathname: "/app/tab123" });
    mockUseMatches.mockReturnValue([
      { pathname: "/app/tab123", params: { id: "tab123" } },
    ]);

    mockUseShallowAppStore.mockImplementation((selector) =>
      selector({
        items: {
          tab123: { data: { name: "Dashboard alpha" } },
        },
      }),
    );

    renderHook(() => useGlobalTitleManager());

    expect(document.title).toBe("Dashboard alpha | Workspace");
  });

  it("should resolve dynamic tab titles from shared app store", () => {
    mockUseLocation.mockReturnValue({ pathname: "/app/tab456" });
    mockUseMatches.mockReturnValue([
      { pathname: "/app/tab456", params: { id: "tab456" } },
    ]);

    mockUseShallowAppStore.mockImplementation((selector) => selector({}));

    mockUseShallowSharedAppStore.mockImplementation((selector) =>
      selector({
        sharedItems: {
          tab456: { data: { name: "Shared Dashboard" } },
        },
      }),
    );

    renderHook(() => useGlobalTitleManager());

    expect(document.title).toBe("Shared Dashboard | Workspace");
  });
});
