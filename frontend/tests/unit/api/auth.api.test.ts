import { v4 as uuidv4 } from "uuid";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "~/api/api";
import {
  activateQRCode,
  deleteApiSource,
  deleteFileWidget,
  deleteUploadedFile,
  deleteUploadedFiles,
  deleteWidgetMetadata,
  generateQRCode,
  getAgentConnectionErrorMessage,
  getApiSources,
  getCopilotChat,
  getFileWidgets,
  getStoredFiles,
  getUsage,
  getUser,
  getUserChats,
  getWidgetMetadata,
  googleLogin,
  login,
  logout,
  patchWidgetMetadata,
  postApiSource,
  postFileWidget,
  postUserChats,
  postWidgetMetadata,
  searchChats,
  updateFullName,
  updatePassword,
  userHasEntity,
  validateUser,
} from "~/api/auth.api";
import { malformed } from "../mocks";

// Mock the apiClient
vi.mock("~/api/api", () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    put: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  },
}));

describe("API Client Functions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getAgentConnectionErrorMessage", () => {
    it("maps generic fetch network errors to a more actionable message", () => {
      const message = getAgentConnectionErrorMessage(new Error("Failed to fetch"));
      expect(message).toContain("Could not reach the agent server");
      expect(message).toContain("CORS");
    });

    it("keeps non-network error messages unchanged", () => {
      const message = getAgentConnectionErrorMessage(
        new Error("Unauthorized access to the copilot URL."),
      );
      expect(message).toBe("Unauthorized access to the copilot URL.");
    });
  });

  describe("login", () => {
    it("should return data on successful login", async () => {
      const mockResponse = { status: 200, data: { token: "abc123" } };

      vi.spyOn(apiClient, "post").mockResolvedValue(mockResponse);

      const response = await login("test@example.com", "password");
      expect(apiClient.post).toHaveBeenCalledWith("/app/login", expect.any(Object));
      expect(response).toEqual({ status: 200, token: "abc123" });
    });

    it("should handle login errors", async () => {
      const mockError = {
        response: { status: 401, data: { detail: "Invalid credentials" } },
      };
      vi.spyOn(apiClient, "post").mockRejectedValue(mockError);

      const response = await login("test@example.com", "wrong-password");
      expect(response).toEqual({ status: 401, detail: "Invalid credentials" });
    });
  });

  describe("validateUser", () => {
    it("should return user data on successful validation", async () => {
      const mockResponse = { data: { user: "testUser" } };
      vi.spyOn(apiClient, "get").mockResolvedValue(mockResponse);

      const data = await validateUser();
      expect(apiClient.get).toHaveBeenCalledWith("/app/validate");
      expect(data).toEqual({ user: "testUser" });
    });
  });

  describe("logout", () => {
    it("should return data on successful logout", async () => {
      const mockResponse = { status: 200, data: { success: true } };
      vi.spyOn(apiClient, "post").mockResolvedValue(mockResponse);

      const response = await logout();
      expect(apiClient.post).toHaveBeenCalledWith("/app/logout");
      expect(response).toEqual({ success: true });
    });
  });

  describe("googleLogin", () => {
    it("should return data on successful Google login", async () => {
      const mockResponse = { status: 200, data: { token: "googleToken" } };
      vi.spyOn(apiClient, "post").mockResolvedValue(mockResponse);

      const response = await googleLogin("google-id-token");
      expect(apiClient.post).toHaveBeenCalledWith(
        "/app/google-auth",
        expect.any(Object),
      );
      expect(response).toEqual({ token: "googleToken", status: 200 });
    });
  });

  describe("getUserChats", () => {
    it("should return user chats", async () => {
      const mockResponse = { data: { chats: [{ id: 1, message: "Hello" }] } };
      vi.spyOn(apiClient, "get").mockResolvedValue(mockResponse);

      const data = await getUserChats();
      expect(apiClient.get).toHaveBeenCalledWith("/app/copilot-chats");
      expect(data).toEqual({ chats: [{ id: 1, message: "Hello" }] });
    });
  });

  describe("postUserChats", () => {
    it("should post user chats and return usage", async () => {
      const mockResponse = {
        status: 200,
        data: {
          number_copilot_calls_day_count: 0,
          total_file_upload_size_gb_count: 0.02411199826747179,
          copilot_calls_limit: 100,
          file_upload_size_limit: 50.0,
        },
      };
      vi.spyOn(apiClient, "post").mockResolvedValue(mockResponse);
      const uuid = uuidv4();

      const chats = {
        [uuid]: {
          uuid,
          createdAt: 1721284317112,
          label: "My Sample Chat",
          messages: {},
          titleManuallyUpdated: false,
          titleNeedsUpdate: false,
          lastOpened: 0,
        },
      };

      const response = await postUserChats(chats);
      expect(apiClient.post).toHaveBeenCalledWith("/app/copilot-chats", { chats });
      expect(response).toEqual({ status: 200, usage: mockResponse.data });
    });
  });

  describe("searchChats", () => {
    it("should search chats and map messages to recentMessages", async () => {
      const mockResponse = {
        data: [
          {
            uuid: "chat-1",
            createdAt: 1000,
            label: "My Sample Chat",
            messages: [
              { role: "human", content: "Hello", timestamp: 1, copilotId: "cp" },
              { role: "ai", content: "Hi there", timestamp: 2, copilotId: "cp" },
              { role: "ai", content: "", timestamp: 3, copilotId: "cp" },
            ],
          },
        ],
      };
      vi.spyOn(apiClient, "get").mockResolvedValue(mockResponse);

      const data = await searchChats("  hello  ");
      expect(apiClient.get).toHaveBeenCalledWith("/app/copilot-chats/search", {
        params: { query: "hello" },
      });
      expect(data.results).toEqual([
        {
          uuid: "chat-1",
          createdAt: 1000,
          label: "My Sample Chat",
          recentMessages: ["Hello", "Hi there"],
        },
      ]);
    });

    it("should return an empty results array when the request fails", async () => {
      vi.spyOn(apiClient, "get").mockRejectedValue(new Error("network error"));

      const data = await searchChats("query");
      expect(data.results).toEqual([]);
    });

    it("should default to an empty recentMessages array when there are no messages", async () => {
      const mockResponse = {
        data: [{ uuid: "chat-1", createdAt: 1000, label: "Empty Chat" }],
      };
      vi.spyOn(apiClient, "get").mockResolvedValue(mockResponse);

      const data = await searchChats("query");
      expect(data.results).toEqual([
        { uuid: "chat-1", createdAt: 1000, label: "Empty Chat", recentMessages: [] },
      ]);
    });

    it("should return the original search query alongside the results", async () => {
      vi.spyOn(apiClient, "get").mockResolvedValue({ data: [] });

      const data = await searchChats("budget report");
      expect(data.searchQuery).toBe("budget report");
    });
  });

  describe("getCopilotChat", () => {
    it("should return the chat for the given uuid", async () => {
      const mockChat = { uuid: "chat-1", createdAt: 1000, label: "Chat", messages: [] };
      vi.spyOn(apiClient, "get").mockResolvedValue({ data: mockChat });

      const data = await getCopilotChat("chat-1");
      expect(apiClient.get).toHaveBeenCalledWith("/app/copilot-chats/chat-1");
      expect(data).toEqual(mockChat);
    });

    it("should return null when the request fails", async () => {
      vi.spyOn(apiClient, "get").mockRejectedValue(new Error("not found"));

      const data = await getCopilotChat("chat-1");
      expect(data).toBeNull();
    });
  });

  describe("getUser", () => {
    it("should return user data", async () => {
      const mockResponse = { data: { user: "testUser" } };
      vi.spyOn(apiClient, "get").mockResolvedValue(mockResponse);

      const data = await getUser();
      expect(apiClient.get).toHaveBeenCalledWith("/app/user");
      expect(data).toEqual({ user: "testUser" });
    });
  });

  describe("updatePassword", () => {
    it("should return status on successful password update", async () => {
      const mockResponse = { status: 200 };
      vi.spyOn(apiClient, "put").mockResolvedValue(mockResponse);

      const response = await updatePassword("oldPass", "newPass");
      expect(apiClient.put).toHaveBeenCalledWith("/user", {
        old_password: "oldPass",
        new_password: "newPass",
      });
      expect(response).toEqual(200);
    });
  });

  describe("updateFullName", () => {
    it("should return status on successful full name update", async () => {
      const mockResponse = { status: 200 };
      vi.spyOn(apiClient, "put").mockResolvedValue(mockResponse);

      const response = await updateFullName("John", "Doe");
      expect(apiClient.put).toHaveBeenCalledWith("/user", {
        first_name: "John",
        last_name: "Doe",
      });
      expect(response).toEqual(200);
    });
  });

  describe("generateQRCode", () => {
    it("should return QR code data on successful generation", async () => {
      const mockResponse = { data: { uri: "someUri", secret: "someSecret" } };
      vi.spyOn(apiClient, "post").mockResolvedValue(mockResponse);

      const response = await generateQRCode();
      expect(apiClient.post).toHaveBeenCalledWith("/totp");
      expect(response).toEqual(mockResponse.data);
    });
  });

  describe("activateQRCode", () => {
    it("should return status on successful QR code activation", async () => {
      const mockResponse = { status: 200 };
      vi.spyOn(apiClient, "post").mockResolvedValue(mockResponse);

      const response = await activateQRCode(123456);
      expect(apiClient.post).toHaveBeenCalledWith("/totp/activate", {
        totp_token: 123456,
      });
      expect(response).toEqual(200);
    });
  });

  describe("getApiSources", () => {
    it("should return API sources", async () => {
      const mockResponse = { data: [{ id: "source1" }] };
      vi.spyOn(apiClient, "get").mockResolvedValue(mockResponse);

      const data = await getApiSources();
      expect(apiClient.get).toHaveBeenCalledWith("/app/data-connectors/api-source");
      expect(data).toEqual(mockResponse.data);
    });
  });

  describe("postApiSource", () => {
    it("should post an API source and return status", async () => {
      const mockResponse = { status: 201 };
      vi.spyOn(apiClient, "post").mockResolvedValue(mockResponse);

      const data = { name: "source", url: "http://example.com" };
      const response = await postApiSource("sourceUuid", data);
      expect(apiClient.post).toHaveBeenCalledWith(
        "/app/data-connectors/api-source/sourceUuid",
        data,
      );
      expect(response).toEqual({ status: 201 });
    });
  });

  describe("deleteApiSource", () => {
    it("should delete an API source and return status", async () => {
      const mockResponse = { status: 204 };
      vi.spyOn(apiClient, "delete").mockResolvedValue(mockResponse);

      const response = await deleteApiSource("sourceUuid");
      expect(apiClient.delete).toHaveBeenCalledWith(
        "/app/data-connectors/api-source/sourceUuid",
      );
      expect(response).toEqual({ status: 204 });
    });
  });

  describe("getStoredFiles", () => {
    it("should return stored files", async () => {
      const mockResponse = { data: [{ uuid: "file1" }] };
      vi.spyOn(apiClient, "get").mockResolvedValue(mockResponse);

      const data = await getStoredFiles();
      expect(apiClient.get).toHaveBeenCalledWith("/app/files");
      expect(data).toEqual(mockResponse.data);
    });
  });

  describe("getFileWidgets", () => {
    it("should return file widgets", async () => {
      const mockResponse = { data: [{ uuid: "widget1" }] };
      vi.spyOn(apiClient, "get").mockResolvedValue(mockResponse);

      const data = await getFileWidgets();
      expect(apiClient.get).toHaveBeenCalledWith("/app/data-connectors/file");
      expect(data).toEqual(mockResponse.data);
    });
  });

  describe("postFileWidget", () => {
    it("should post a file widget and return status", async () => {
      const mockResponse = { status: 201 };
      vi.spyOn(apiClient, "post").mockResolvedValue(mockResponse);

      const data = { name: "fileWidget", extension: "pdf" };

      const response = await postFileWidget("sourceUuid", malformed(data));
      expect(apiClient.post).toHaveBeenCalledWith(
        "/app/data-connectors/file/sourceUuid",
        data,
        { signal: undefined },
      );
      expect(response).toEqual({ status: 201 });
    });
  });

  describe("deleteUploadedFile", () => {
    it("should delete an uploaded file and return status", async () => {
      const mockResponse = { status: 204 };
      vi.spyOn(apiClient, "delete").mockResolvedValue(mockResponse);

      const response = await deleteUploadedFile("fileUuid");
      expect(apiClient.delete).toHaveBeenCalledWith("/app/files/fileUuid");
      expect(response).toEqual({ status: 204 });
    });
  });

  describe("deleteUploadedFiles", () => {
    it("should delete multiple uploaded files and return status", async () => {
      const mockResponse = { status: 204 };
      vi.spyOn(apiClient, "delete").mockResolvedValue(mockResponse);

      const response = await deleteUploadedFiles(["fileUuid1", "fileUuid2"]);
      expect(apiClient.delete).toHaveBeenCalledWith("/app/files", {
        data: { file_uuids: ["fileUuid1", "fileUuid2"] },
      });
      expect(response).toEqual({ status: 204 });
    });
  });

  describe("deleteFileWidget", () => {
    it("should delete a file widget and return status", async () => {
      const mockResponse = { status: 204 };
      vi.spyOn(apiClient, "delete").mockResolvedValue(mockResponse);

      const response = await deleteFileWidget("sourceUuid");
      expect(apiClient.delete).toHaveBeenCalledWith(
        "/app/data-connectors/file/sourceUuid",
      );
      expect(response).toEqual({ status: 204 });
    });
  });

  describe("getWidgetMetadata", () => {
    it("should return widget metadata", async () => {
      const mockResponse = { data: [{ id: "metadata1" }] };
      vi.spyOn(apiClient, "get").mockResolvedValue(mockResponse);

      const data = await getWidgetMetadata("iframe", "widgetName", "widgetId");
      expect(apiClient.get).toHaveBeenCalledWith("/app/widget-metadata", {
        params: new URLSearchParams({
          widget_type: "iframe",
          name: "widgetName",
          widget_id: "widgetId",
        }),
      });
      expect(data).toEqual(mockResponse.data);
    });
  });

  describe("postWidgetMetadata", () => {
    it("should post widget metadata and return success", async () => {
      const mockResponse = { data: { success: true } };
      vi.spyOn(apiClient, "post").mockResolvedValue(mockResponse);

      const metadata = {
        widgetId: "widget-123",
        widgetType: "iframe",
        name: "Test Widget",
        description: "Test description",
        category: "Test Category",
        subCategory: "Test SubCategory",
        source: "Test Source",
      };

      const response = await postWidgetMetadata(malformed(metadata));
      expect(apiClient.post).toHaveBeenCalledWith("/app/widget-metadata", metadata);
      expect(response).toEqual(mockResponse.data);
    });
  });

  describe("patchWidgetMetadata", () => {
    it("should patch widget metadata and return success", async () => {
      const mockResponse = { success: true };
      vi.spyOn(apiClient, "patch").mockResolvedValue({ data: mockResponse });

      const metadata = { id: "metadata1" };

      const response = await patchWidgetMetadata(
        malformed(metadata),
        "widgetId",
        "iframe",
        "name",
      );
      expect(apiClient.patch).toHaveBeenCalledWith("/app/widget-metadata", metadata, {
        params: new URLSearchParams({
          widget_id: "widgetId",
          widget_type: "iframe",
          name: "name",
        }),
      });
      expect(response).toEqual(mockResponse);
    });
  });

  describe("deleteWidgetMetadata", () => {
    it("should delete widget metadata and return data", async () => {
      const mockResponse = { data: [{ id: "metadata1" }] };
      vi.spyOn(apiClient, "delete").mockResolvedValue(mockResponse);

      const data = await deleteWidgetMetadata("widgetId");
      expect(apiClient.delete).toHaveBeenCalledWith("/app/widget-metadata/widgetId");
      expect(data).toEqual(mockResponse.data);
    });
  });

  describe("userHasEntity", () => {
    it("should return if user has entity", async () => {
      const mockResponse = { data: { success: true } };
      vi.spyOn(apiClient, "get").mockResolvedValue(mockResponse);

      const data = await userHasEntity();
      expect(apiClient.get).toHaveBeenCalledWith("/app/user-has-entity");
      expect(data).toEqual(mockResponse.data);
    });
  });

  describe("getUsage", () => {
    it("should return usage data", async () => {
      const mockResponse = { data: { usage: "data" } };
      vi.spyOn(apiClient, "get").mockResolvedValue(mockResponse);

      const data = await getUsage();
      expect(apiClient.get).toHaveBeenCalledWith("/app/usage");
      expect(data).toEqual(mockResponse.data);
    });
  });
});
