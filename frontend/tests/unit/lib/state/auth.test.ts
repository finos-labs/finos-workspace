import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AuthState, useAuthStore } from "~/lib/state/auth";

// Mock all external dependencies
vi.mock("~/api/auth.api", () => ({
  logout: vi.fn(),
}));

vi.mock("~/lib/state/copilot", () => ({
  useCopilotStore: {
    persist: { clearStorage: vi.fn() },
  },
}));

vi.mock("~/lib/state/sharedApp", () => ({
  useSharedAppStore: {
    persist: { clearStorage: vi.fn() },
  },
}));

vi.mock("~/lib/state/theme", () => ({
  useThemeStore: {
    persist: { clearStorage: vi.fn() },
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Store the initial state for resetting
let initialState: AuthState;

describe("useAuthStore", () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    initialState = useAuthStore.getState();
    useAuthStore.setState({
      user: null,
      showChangelog: false,
      promptHistory: [],
      perplexityApiKey: "",
      openaiApiKey: "",
      lastVisitedPage: "/app",
      isFirstLogin: false,
      alphaWarning: true,
      name: { first: "", last: "" },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("API keys management", () => {
    it("should set perplexity API key", () => {
      useAuthStore.getState().setPerplexityApiKey("test-perplexity-key");
      expect(useAuthStore.getState().perplexityApiKey).toBe("test-perplexity-key");
    });

    it("should set openai API key", () => {
      useAuthStore.getState().setOpenaiApiKey("test-openai-key");
      expect(useAuthStore.getState().openaiApiKey).toBe("test-openai-key");
    });

    it("should set both copilot API keys at once", () => {
      useAuthStore.getState().setCopilotApiKeys({
        perplexityApiKey: "perplexity-123",
        openaiApiKey: "openai-456",
      });

      const state = useAuthStore.getState();
      expect(state.perplexityApiKey).toBe("perplexity-123");
      expect(state.openaiApiKey).toBe("openai-456");
    });

    it("should handle empty strings in setCopilotApiKeys", () => {
      useAuthStore.getState().setPerplexityApiKey("existing-key");
      useAuthStore.getState().setCopilotApiKeys({
        perplexityApiKey: "",
        openaiApiKey: "",
      });

      const state = useAuthStore.getState();
      expect(state.perplexityApiKey).toBe("");
      expect(state.openaiApiKey).toBe("");
    });
  });

  describe("lastVisitedPage", () => {
    it("should update last visited page", () => {
      useAuthStore.getState().updateLastVisitedPage("/app/dashboard/123");
      expect(useAuthStore.getState().lastVisitedPage).toBe("/app/dashboard/123");
    });

    it("should handle various page paths", () => {
      const paths = ["/app", "/app/settings", "/app/dashboard/abc-123?tab=overview"];

      for (const path of paths) {
        useAuthStore.getState().updateLastVisitedPage(path);
        expect(useAuthStore.getState().lastVisitedPage).toBe(path);
      }
    });
  });

  describe("updateUser", () => {
    it("should update user with partial data", () => {
      useAuthStore.setState({
        user: {
          email: "test@example.com",
          username: "testuser",
          token: "token123",
          entity_name: null,
          role: null,
          uuid: "uuid-123",
        },
      });

      useAuthStore.getState().updateUser({ email: "new@example.com" });

      const user = useAuthStore.getState().user;
      expect(user?.email).toBe("new@example.com");
      expect(user?.username).toBe("testuser");
      expect(user?.token).toBe("token123");
    });

    it("should handle updating when user is null", () => {
      useAuthStore.setState({ user: null });

      useAuthStore.getState().updateUser({ email: "test@example.com" });

      // Should create user object with the new property
      expect(useAuthStore.getState().user?.email).toBe("test@example.com");
    });
  });

  describe("updateName", () => {
    it("should update name with partial data", () => {
      useAuthStore.setState({ name: { first: "John", last: "Doe" } });

      useAuthStore.getState().updateName({ first: "Jane", last: "Doe" });

      const name = useAuthStore.getState().name;
      expect(name.first).toBe("Jane");
      expect(name.last).toBe("Doe");
    });

    it("should merge with existing name", () => {
      useAuthStore.setState({ name: { first: "John", last: "Doe" } });

      useAuthStore.getState().updateName({ first: "Jane", last: "Smith" });

      const name = useAuthStore.getState().name;
      expect(name.first).toBe("Jane");
      expect(name.last).toBe("Smith");
    });
  });

  describe("updatePromptHistory", () => {
    it("should update prompt history", () => {
      const prompts = [
        { prompt: "Show me AAPL data", widgetId: "widget1" },
        { prompt: "Compare stocks", widgetId: "widget2" },
      ];

      useAuthStore.getState().updatePromptHistory(prompts);

      expect(useAuthStore.getState().promptHistory).toEqual(prompts);
    });

    it("should replace existing prompt history", () => {
      useAuthStore.setState({
        promptHistory: [{ prompt: "old", widgetId: "old" }],
      });

      const newPrompts = [{ prompt: "new", widgetId: "new" }];
      useAuthStore.getState().updatePromptHistory(newPrompts);

      expect(useAuthStore.getState().promptHistory).toEqual(newPrompts);
    });
  });

  describe("updateShowChangelog", () => {
    it("should update show changelog state", () => {
      useAuthStore.setState({ showChangelog: false });

      useAuthStore.getState().updateShowChangelog(true);
      expect(useAuthStore.getState().showChangelog).toBe(true);
    });
  });

  describe("updateAlphaWarning", () => {
    it("should update alpha warning state", () => {
      useAuthStore.setState({ alphaWarning: true });

      useAuthStore.getState().updateAlphaWarning(false);
      expect(useAuthStore.getState().alphaWarning).toBe(false);
    });
  });
});
