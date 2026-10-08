import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "~/lib/state/auth";
import type { LoginResponse } from "~/types/auth.type";
import { type DeepPartial, partial } from "../../mocks";

// Mock all external dependencies
vi.mock("~/api/auth.api", () => ({
  logout: vi.fn(),
}));

vi.mock("~/lib/state/copilot", () => ({
  useCopilotStore: {
    persist: { clearStorage: vi.fn() },
  },
}));

vi.mock("~/lib/state/theme", () => ({
  useThemeStore: {
    persist: { clearStorage: vi.fn() },
  },
}));

vi.mock("~/lib/state/sharedApp", () => ({
  useSharedAppStore: {
    persist: { clearStorage: vi.fn() },
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe("useAuthStore - Login Tests", () => {
  const createMockLoginResponse = (
    overrides: DeepPartial<LoginResponse> = {},
  ): LoginResponse =>
    partial<LoginResponse>({
      email: "test@example.com",
      username: "testuser",
      access_token: "token-123",
      entity_name: "Test Entity",
      role: "user",
      uuid: "user-uuid-123",
      is_first_login: false,
      show_changelog: false,
      microsoftIdToken: undefined,
      oktaIdToken: undefined,
      feature_entitlements: { tier: "full" },
      user: {
        first_name: "Test",
        last_name: "User",
        display_settings: {
          lastVisitedPage: "/app",
        },
      },
      ...overrides,
    });

  beforeEach(() => {
    useAuthStore.setState({
      user: null,
      isFirstLogin: false,
      showChangelog: false,
      name: { first: "", last: "" },
      promptHistory: [],
      lastVisitedPage: "/app",
      openaiApiKey: "",
      perplexityApiKey: "",
      alphaWarning: true,
      microsoftIdToken: "",
      oktaIdToken: "",
    });
    vi.clearAllMocks();
  });

  describe("login", () => {
    it("sets user data from login response", async () => {
      const response = createMockLoginResponse();
      const { login } = useAuthStore.getState();

      await login(response);

      const state = useAuthStore.getState();
      expect(state.user?.email).toBe("test@example.com");
      expect(state.user?.username).toBe("testuser");
      expect(state.user?.token).toBe("token-123");
      expect(state.user?.uuid).toBe("user-uuid-123");
    });

    it("sets name from user data", async () => {
      const response = createMockLoginResponse({
        user: {
          first_name: "John",
          last_name: "Doe",
          display_settings: {},
        },
      });
      const { login } = useAuthStore.getState();

      await login(response);

      const state = useAuthStore.getState();
      expect(state.name.first).toBe("John");
      expect(state.name.last).toBe("Doe");
    });

    it("sets showChangelog from response", async () => {
      const response = createMockLoginResponse({ show_changelog: true });
      const { login } = useAuthStore.getState();

      await login(response);

      expect(useAuthStore.getState().showChangelog).toBe(true);
    });

    it("sets isFirstLogin from response", async () => {
      const response = createMockLoginResponse({ is_first_login: true });
      const { login } = useAuthStore.getState();

      await login(response);

      expect(useAuthStore.getState().isFirstLogin).toBe(true);
    });

    it("sets lastVisitedPage from display settings", async () => {
      const response = createMockLoginResponse({
        user: {
          first_name: "Test",
          last_name: "User",
          display_settings: {
            lastVisitedPage: "/app/explore",
          },
        },
      });
      const { login } = useAuthStore.getState();

      await login(response);

      expect(useAuthStore.getState().lastVisitedPage).toBe("/app/explore");
    });

    it("sets API keys from display settings", async () => {
      const response = createMockLoginResponse({
        user: {
          first_name: "Test",
          last_name: "User",
          display_settings: {
            openaiApiKey: "openai-key-123",
            perplexityApiKey: "perplexity-key-456",
          },
        },
      });
      const { login } = useAuthStore.getState();

      await login(response);

      const state = useAuthStore.getState();
      expect(state.openaiApiKey).toBe("openai-key-123");
      expect(state.perplexityApiKey).toBe("perplexity-key-456");
    });
  });
});
