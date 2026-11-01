import { v4 as uuidv4 } from "uuid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "~/api/api";
import {
  activateTotp,
  deleteApiSource,
  deleteFileWidget,
  deleteUploadedFile,
  deleteUploadedFiles,
  deleteWidgetMetadata,
  fetchAgentsData,
  fetchDefaultAgent,
  generateQRCode,
  getAgentConnectionErrorMessage,
  getApiSources,
  getCopilotChat,
  getFileWidgets,
  getSession,
  getUsage,
  getWidgetMetadata,
  googleLogin,
  login,
  logout,
  patchWidgetMetadata,
  postApiSource,
  postFileWidget,
  postUserChats,
  postWidgetMetadata,
  putCustomCopilot,
  resetPassword,
  searchChats,
  startSignIn,
  tryAgentsData,
  updatePassword,
  validateUser,
} from "~/api/auth.api";
import { VERSION } from "~/lib/constants";
import { mockConfig } from "../../mocks/runtimeConfig";
import { malformed } from "../mocks";

vi.mock("~/api/api", () => ({
  setOnSessionRefused: vi.fn(),
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

  describe("getSession", () => {
    it("returns the signed-in user the session cookie stands for", async () => {
      const session = { uuid: "u-1", email: "a@b.test" };
      vi.spyOn(apiClient, "get").mockResolvedValue({ data: session });

      await expect(getSession()).resolves.toEqual(session);
      expect(apiClient.get).toHaveBeenCalledWith("/app/session");
    });

    it("returns null when there is no session", async () => {
      vi.spyOn(apiClient, "get").mockRejectedValue({ response: { status: 401 } });

      await expect(getSession()).resolves.toBeNull();
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

    it("counts a session the API no longer knows as ended", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(apiClient, "post").mockRejectedValue({ response: { status: 401 } });

      await expect(logout()).resolves.toEqual({ success: true });
    });

    it("reports any other failure, so the page keeps the session", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(apiClient, "post").mockRejectedValue({ response: { status: 500 } });

      await expect(logout()).resolves.toEqual({ success: false });
    });
  });

  describe("startSignIn", () => {
    it.each([
      "microsoft",
      "okta",
    ] as const)("asks the API where to send the browser for %s", async (provider) => {
      vi.spyOn(apiClient, "post").mockResolvedValue({
        data: { authorization_url: "https://idp.example.com/authorize" },
      });

      await expect(startSignIn(provider)).resolves.toBe(
        "https://idp.example.com/authorize",
      );
      expect(apiClient.post).toHaveBeenCalledWith(`/app/sign-in/${provider}/start`, {
        version: VERSION,
      });
    });
  });

  describe("activateTotp", () => {
    it("activates with the session (or enrollment) cookie and returns the status", async () => {
      const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);

      await expect(activateTotp(123456)).resolves.toBe(200);

      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("http://localhost:3000/totp/activate");
      expect(init.credentials).toBe("include");
      expect(new Headers(init.headers).get("X-Workspace-Client")).toBe("web");
      expect(new Headers(init.headers).get("Authorization")).toBeNull();
      expect(JSON.parse(init.body as string)).toEqual({ totp_token: 123456 });
      vi.unstubAllGlobals();
    });

    it("at sign-in sends the sign-in's remember and version with the code", async () => {
      const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);

      await expect(activateTotp(123456, { remember: true })).resolves.toBe(200);

      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(JSON.parse(init.body as string)).toEqual({
        totp_token: 123456,
        remember: true,
        version: VERSION,
      });
      vi.unstubAllGlobals();
    });

    it("returns a wrong code's 401 without touching the session", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("{}", { status: 401 })),
      );

      await expect(activateTotp(999999)).resolves.toBe(401);
      vi.unstubAllGlobals();
    });
  });

  describe("fetchDefaultAgent", () => {
    it("reads the default agent from the AI API's public agents.json", async () => {
      const descriptor = { description: "", endpoints: { query: "/v1/query" } };
      const fetchMock = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              other_agent: { ...descriptor, name: "Other" },
              default_agent: { ...descriptor, name: "Agent" },
            }),
            { status: 200 },
          ),
      );
      vi.stubGlobal("fetch", fetchMock);

      const agent = await fetchDefaultAgent();

      expect(agent?.id).toBe("default_agent");
      expect(agent?.name).toBe("Agent");
      const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
      expect(String(url)).toBe(`${mockConfig.urls.ai}/agents.json`);
      expect(init.credentials).toBeUndefined();
      vi.unstubAllGlobals();
    });

    it("reads nothing when no AI API is configured", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const ai = mockConfig.urls.ai;
      mockConfig.urls.ai = "";

      try {
        await expect(fetchDefaultAgent()).resolves.toBeUndefined();
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        mockConfig.urls.ai = ai;
        vi.unstubAllGlobals();
      }
    });
  });

  describe("agents whose credentials the API keeps", () => {
    const file = {
      support: {
        name: "Support",
        description: "Helps",
        endpoints: { query: "/v1/query" },
      },
    };

    beforeEach(() => {
      vi.stubGlobal("fetch", vi.fn());
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("reads a saved agent's agents.json through the API, by id, and never itself", async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { status: 200, agents: file },
      });

      const agents = await fetchAgentsData({
        uuid: "holder-1",
        url: "https://agents.test/api",
        headers: { "X-Api-Key": "" },
      });

      expect(apiClient.post).toHaveBeenCalledWith(
        "/app/custom-copilot/discover",
        {
          id: "holder-1",
          url: "https://agents.test/api",
          headers: { "X-Api-Key": "" },
        },
        { signal: undefined },
      );
      expect(fetch).not.toHaveBeenCalled();
      expect(agents).toHaveLength(1);
      expect(agents[0]).toMatchObject({
        id: "support",
        holderUuid: "holder-1",
        endpoints: { query: "https://agents.test/api/v1/query" },
      });
    });

    it("tries a new agent with what was typed and no id", async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { status: 200, agents: file },
      });

      await tryAgentsData({
        url: "https://agents.test",
        headers: { "X-Api-Key": "typed" },
      });

      expect(apiClient.post).toHaveBeenCalledWith(
        "/app/custom-copilot/discover",
        { url: "https://agents.test", headers: { "X-Api-Key": "typed" } },
        { signal: undefined },
      );
      expect(fetch).not.toHaveBeenCalled();
    });

    it.each([
      [401, "Unauthorized access to the agent URL."],
      [404, "A valid /agents.json was not found."],
      [500, "Internal server error."],
      [418, "Unknown error occurred while validating URL."],
    ])("says what the agent's %s means", async (status, message) => {
      vi.mocked(apiClient.post).mockResolvedValue({ data: { status, agents: null } });

      await expect(tryAgentsData({ url: "https://agents.test" })).rejects.toThrow(
        message,
      );
    });

    it("says so when the agent answered something that is not an agents file", async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { status: 200, agents: null },
      });

      await expect(tryAgentsData({ url: "https://agents.test" })).rejects.toThrow(
        "Invalid response from the agent server.",
      );
    });

    it("shows the reason when the API refused to call the address", async () => {
      vi.mocked(apiClient.post).mockRejectedValue({
        response: {
          data: {
            detail:
              "a connection kept by a user who is not a superuser must be a public https address",
          },
        },
      });

      await expect(tryAgentsData({ url: "http://10.0.0.1" })).rejects.toThrow(
        "must be a public https address",
      );
    });

    it("still reads a public agents.json straight from its address when it names no saved agent", async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify(file), { status: 200 }),
      );

      const agents = await fetchAgentsData({ url: "https://public.test" });

      expect(agents).toHaveLength(1);
      expect(apiClient.post).not.toHaveBeenCalled();
    });

    it("saves with the typed credentials and gives back the agent with their names only", async () => {
      vi.mocked(apiClient.put).mockResolvedValue({ data: { success: true } });

      const saved = await putCustomCopilot({
        uuid: "holder-1",
        url: "https://agents.test",
        headers: { "X-Api-Key": "typed", Authorization: "Bearer typed" },
        copilots: [],
      });

      expect(apiClient.put).toHaveBeenCalledWith(
        "/app/custom-copilot",
        expect.objectContaining({
          headers: { "X-Api-Key": "typed", Authorization: "Bearer typed" },
        }),
      );
      expect(saved.headerNames).toEqual(["X-Api-Key", "Authorization"]);
      expect(JSON.stringify(saved)).not.toContain("typed");
      expect(saved).not.toHaveProperty("headers");
    });

    it("saves without credentials when it has none to change and keeps the names it knew", async () => {
      vi.mocked(apiClient.put).mockResolvedValue({ data: { success: true } });

      const saved = await putCustomCopilot({
        uuid: "holder-1",
        url: "https://agents.test",
        headerNames: ["X-Api-Key"],
        copilots: [],
      });

      expect(vi.mocked(apiClient.put).mock.calls[0][1]).not.toHaveProperty("headers");
      expect(saved.headerNames).toEqual(["X-Api-Key"]);
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

  describe("resetPassword", () => {
    it("sends the link's token and the new password in the body", async () => {
      vi.spyOn(apiClient, "post").mockResolvedValue({ status: 200 });

      const response = await resetPassword("the-token", "NewPassword456!");

      expect(apiClient.post).toHaveBeenCalledWith("/app/reset-password", {
        token: "the-token",
        new_password: "NewPassword456!",
      });
      expect(response).toEqual({ status: 200 });
    });

    it("returns the status and what the API said went wrong", async () => {
      vi.spyOn(apiClient, "post").mockRejectedValue({
        response: { status: 400, data: { detail: "This link has expired." } },
      });

      expect(await resetPassword("used", "NewPassword456!")).toEqual({
        status: 400,
        detail: "This link has expired.",
      });
    });

    it("returns 500 when the API never answered", async () => {
      vi.spyOn(apiClient, "post").mockRejectedValue(new Error("Network Error"));

      expect(await resetPassword("token", "NewPassword456!")).toEqual({
        status: 500,
        detail: undefined,
      });
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

      const data = await getWidgetMetadata();
      expect(apiClient.get).toHaveBeenCalledWith("/app/widget-metadata");
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

      const response = await patchWidgetMetadata(malformed(metadata), "widgetId");
      expect(apiClient.patch).toHaveBeenCalledWith("/app/widget-metadata", metadata, {
        params: new URLSearchParams({ widget_id: "widgetId" }),
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
