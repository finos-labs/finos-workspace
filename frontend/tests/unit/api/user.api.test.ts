import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "~/api/api";
import { updateUserDisplaySettings } from "~/api/user.api";
import type { DisplaySettings } from "~/types/auth.type";
import { partial } from "../mocks";

// Mock apiClient
vi.mock("~/api/api", () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

// Mock useThemeStore
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
