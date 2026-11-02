import axios, { type AxiosError } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HttpResponse,
  http,
  mockAccess,
  mockCopilotKeys,
  mockDashboardData,
  mockSession,
  mockUsage,
  mockUser,
  mockValidateResponse,
  server,
  setupMSW,
} from "../../mocks/msw-utils";

const BASE_URL = "https://backend.test";

const testClient = axios.create({
  baseURL: BASE_URL,
});

const WEB_CLIENT = { headers: { "X-Workspace-Client": "web" } };

async function refusal(request: Promise<unknown>): Promise<AxiosError> {
  try {
    await request;
  } catch (error) {
    if (axios.isAxiosError(error)) return error;
    throw error;
  }
  throw new Error("Should have thrown an error");
}

describe("MSW Integration - Auth API", () => {
  setupMSW();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /app/login", () => {
    it("should return user data on successful login", async () => {
      const { data, status } = await testClient.post("/app/login", {
        email: "test@example.com",
        password: "password123",
        remember: false,
      });

      expect(status).toBe(200);
      expect(data).toHaveProperty("uuid", mockUser.uuid);
      expect(data).toHaveProperty("email", mockUser.email);
      expect(data).not.toHaveProperty("token");
      expect(data).not.toHaveProperty("access_token");
    });

    it("should return 401 for invalid credentials", async () => {
      const error = await refusal(
        testClient.post("/app/login", {
          email: "invalid@example.com",
          password: "wrongpassword",
        }),
      );
      expect(error.response?.status).toBe(401);
      expect(error.response?.data).toMatchObject({ detail: "Invalid credentials" });
    });

    it("answers 202 with a flag when the organization requires an authenticator", async () => {
      const { data, status } = await testClient.post("/app/login", {
        email: "2fa@example.com",
        password: "password123",
      });

      expect(status).toBe(202);
      expect(data).toEqual({
        two_factor_required: true,
        message: "Two-factor authentication is required",
      });
    });
  });

  describe("GET /app/validate", () => {
    it("should validate authenticated user", async () => {
      const { data, status } = await testClient.get("/app/validate", WEB_CLIENT);

      expect(status).toBe(200);
      expect(data).toHaveProperty("uuid");
      expect(data).toHaveProperty("valid", true);
    });

    it("refuses a request that does not name the web client", async () => {
      const error = await refusal(
        testClient.get("/app/validate", {
          headers: { Authorization: "Bearer some-token" },
        }),
      );
      expect(error.response?.status).toBe(401);
    });
  });

  describe("GET /app/session", () => {
    it("returns the signed-in user for the web client", async () => {
      const { data, status } = await testClient.get("/app/session", WEB_CLIENT);

      expect(status).toBe(200);
      expect(data).toEqual(mockSession);
    });

    it("answers 401 otherwise", async () => {
      const error = await refusal(testClient.get("/app/session"));
      expect(error.response?.status).toBe(401);
    });
  });

  describe("POST /app/copilot/token", () => {
    it("mints a short-lived agent token for the web client", async () => {
      const { data } = await testClient.post("/app/copilot/token", null, WEB_CLIENT);

      expect(data).toEqual({ token: "mock-agent-token", expires_in: 1800 });
    });
  });

  describe("/app/copilot-keys", () => {
    it("says which keys are saved, never the keys", async () => {
      const { data } = await testClient.get("/app/copilot-keys", WEB_CLIENT);

      expect(data).toEqual(mockCopilotKeys);
    });

    it("saves a key, removes one with null and leaves an omitted one", async () => {
      const { data } = await testClient.put(
        "/app/copilot-keys",
        { openai_api_key: "sk-test", perplexity_api_key: null },
        WEB_CLIENT,
      );

      expect(data).toEqual({ has_openai_key: true, has_perplexity_key: false });
    });
  });

  describe("identity provider sign-in", () => {
    it("gives the address of the provider's sign-in page", async () => {
      const { data, status } = await testClient.post(
        "/app/sign-in/microsoft/start",
        { version: "1.0.0" },
        WEB_CLIENT,
      );

      expect(status).toBe(200);
      expect(data).toEqual({
        authorization_url: "https://idp.example.com/microsoft/authorize?state=s",
      });
    });

    it("does not start a sign-in with a provider it does not know", async () => {
      const error = await refusal(
        testClient.post("/app/sign-in/other/start", {}, WEB_CLIENT),
      );
      expect(error.response?.status).toBe(404);
    });
  });

  describe("POST /app/logout", () => {
    it("should successfully logout", async () => {
      const { data, status } = await testClient.post("/app/logout");

      expect(status).toBe(200);
      expect(data).toHaveProperty("success", true);
    });
  });

  describe("GET /app/usage", () => {
    it("should return usage data", async () => {
      const { data, status } = await testClient.get("/app/usage");

      expect(status).toBe(200);
      expect(data).toEqual(mockUsage);
    });
  });

  describe("GET /app/access", () => {
    it("should return what the user's roles let them do", async () => {
      const { data, status } = await testClient.get("/app/access");

      expect(status).toBe(200);
      expect(data).toEqual(mockAccess);
    });
  });

  describe("Custom Handler Overrides", () => {
    it("should allow overriding handlers per test", async () => {
      server.use(
        http.get(`${BASE_URL}/app/validate`, () => {
          return HttpResponse.json({
            uuid: "custom-uuid",
            email: "custom@test.com",
            custom_field: "This was added by override",
          });
        }),
      );

      const { data, status } = await testClient.get("/app/validate", WEB_CLIENT);

      expect(status).toBe(200);
      expect(data.uuid).toBe("custom-uuid");
      expect(data.custom_field).toBe("This was added by override");
    });

    it("should reset to default handlers after previous test", async () => {
      const { data } = await testClient.get("/app/validate", WEB_CLIENT);

      expect(data.uuid).toBe(mockValidateResponse.uuid);
      expect(data).not.toHaveProperty("custom_field");
    });

    it("should allow simulating server errors", async () => {
      server.use(
        http.get(`${BASE_URL}/app/validate`, () => {
          return HttpResponse.json(
            { detail: "Internal server error" },
            { status: 500 },
          );
        }),
      );

      const error = await refusal(testClient.get("/app/validate", WEB_CLIENT));
      expect(error.response?.status).toBe(500);
    });

    it("should allow simulating network delays", async () => {
      server.use(
        http.get(`${BASE_URL}/app/validate`, async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return HttpResponse.json(mockValidateResponse);
        }),
      );

      const start = Date.now();
      await testClient.get("/app/validate", WEB_CLIENT);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(100);
    });
  });
});

describe("MSW Integration - Dashboard API", () => {
  setupMSW();

  describe("GET /app/dash/sync", () => {
    it("should return dashboard data", async () => {
      const { data, status } = await testClient.get("/app/dash/sync");

      expect(status).toBe(200);
      expect(data).toEqual(mockDashboardData);
    });
  });

  describe("POST /app/dash/sync", () => {
    it("should save dashboard changes", async () => {
      const changes = {
        "dashboard-1": { content: { name: "Updated Dashboard" } },
      };

      const { data, status } = await testClient.post("/app/dash/sync", {
        items: changes,
      });

      expect(status).toBe(200);
      expect(data).toHaveProperty("success", true);
    });
  });

  describe("POST /app/dash/:dashboardUuid/share", () => {
    it("should share dashboard", async () => {
      const { data, status } = await testClient.post("/app/dash/dashboard-1/share", {
        shares: { "user@example.com": "view" },
      });

      expect(status).toBe(200);
      expect(data).toHaveProperty("success", true);
    });

    it("should return 404 for non-existent dashboard", async () => {
      const error = await refusal(
        testClient.post("/app/dash/non-existent/share", {
          shares: { "user@example.com": "view" },
        }),
      );
      expect(error.response?.status).toBe(404);
    });
  });
});

describe("MSW Integration - 2FA Endpoints", () => {
  setupMSW();

  describe("POST /totp", () => {
    it("should generate TOTP QR code", async () => {
      const { data, status } = await testClient.post("/totp");

      expect(status).toBe(200);
      expect(data).toHaveProperty("uri");
      expect(data).toHaveProperty("secret");
      expect(data.uri).toContain("otpauth://totp/");
    });
  });

  describe("POST /totp/activate", () => {
    it("should activate TOTP with valid code", async () => {
      const { status } = await testClient.post("/totp/activate", {
        totp_token: 123456,
      });

      expect(status).toBe(200);
    });

    it("should reject invalid TOTP code", async () => {
      const error = await refusal(
        testClient.post("/totp/activate", {
          totp_token: 999999,
        }),
      );
      expect(error.response?.status).toBe(400);
    });
  });

  describe("GET /app/2fa", () => {
    it("should return 2FA settings", async () => {
      const { data, status } = await testClient.get("/app/2fa");

      expect(status).toBe(200);
      expect(data).toHaveProperty("two_factor_auth");
      expect(data).toHaveProperty("entity_require_authenticator");
    });
  });
});
