import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "~/api/api";
import {
  getCopilotKeys,
  putCopilotKeys,
  updateUserDisplaySettings,
} from "~/api/user.api";
import type { DisplaySettings } from "~/types/auth.type";
import { partial } from "../mocks";

vi.mock("~/api/api", () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
}));

vi.mock("~/lib/state/theme", () => ({
  useThemeStore: {
    getState: vi.fn().mockReturnValue({
      getDisplaySettings: vi.fn().mockReturnValue({ theme: "dark" }),
    }),
  },
}));

describe("User API functions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("copilot provider keys", () => {
    const flags = { has_openai_key: true, has_perplexity_key: false };

    it("reads which keys are saved, never the keys", async () => {
      vi.spyOn(apiClient, "get").mockResolvedValue({ data: flags });

      await expect(getCopilotKeys()).resolves.toEqual(flags);
      expect(apiClient.get).toHaveBeenCalledWith("/app/copilot-keys");
    });

    it("sends a key to save and null to remove one", async () => {
      vi.spyOn(apiClient, "put").mockResolvedValue({ data: flags });

      await expect(
        putCopilotKeys({ openai_api_key: "sk-new", perplexity_api_key: null }),
      ).resolves.toEqual(flags);
      expect(apiClient.put).toHaveBeenCalledWith("/app/copilot-keys", {
        openai_api_key: "sk-new",
        perplexity_api_key: null,
      });
    });
  });

  describe("updateUserDisplaySettings", () => {
    it("should update display settings with provided settings", async () => {
      const settings = partial<DisplaySettings>({ theme: "light" });
      vi.spyOn(apiClient, "post").mockResolvedValue({});

      await updateUserDisplaySettings(settings);
      expect(apiClient.post).toHaveBeenCalledWith("/app/display-settings", settings);
    });

    it("should update display settings with default settings if none provided", async () => {
      vi.spyOn(apiClient, "post").mockResolvedValue({});

      await updateUserDisplaySettings();
      expect(apiClient.post).toHaveBeenCalledWith("/app/display-settings", {
        theme: "dark",
      });
    });

    it("should log an error if updating display settings fails", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const error = new Error("Network error");
      vi.spyOn(apiClient, "post").mockRejectedValue(error);

      await updateUserDisplaySettings();
      expect(consoleErrorSpy).toHaveBeenCalledWith(error);
    });
  });
});
