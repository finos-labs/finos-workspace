import { HttpResponse, http, type JsonBodyType, passthrough } from "msw";

// Default mock data
export const mockUser = {
  uuid: "test-user-uuid",
  email: "test@example.com",
  first_name: "Test",
  last_name: "User",
  token: "mock-jwt-token",
  is_superuser: false,
};

export const mockValidateResponse = {
  uuid: "test-user-uuid",
  email: "test@example.com",
  valid: true,
};

export const mockDashboardData = {
  owned: {
    "dashboard-1": {
      content: {
        name: "Test Dashboard",
        tabs: [],
        widgets: {},
      },
      updated_at: new Date().toISOString(),
    },
  },
  shared: {},
  entity_shared: {},
};

export const mockUsage = {
  copilot_messages: { used: 10, limit: 100 },
  file_uploads: { used: 5, limit: 50 },
  widgets: { used: 20, limit: 200 },
};

export const mockFeatureFlags = {
  tier: "full",
  features: {
    copilot: true,
    file_uploads: true,
    custom_widgets: true,
  },
};

// Base URL for API - matches VITE_BACKEND_URL in tests
const BASE_URL = "https://backend.test";

export const handlers = [
  // ============ Auth Endpoints ============

  // Login
  http.post(`${BASE_URL}/app/login`, async ({ request }) => {
    const body = (await request.json()) as { email: string; password: string };

    if (body.email === "invalid@example.com") {
      return HttpResponse.json({ detail: "Invalid credentials" }, { status: 401 });
    }

    if (body.email === "2fa@example.com") {
      return HttpResponse.json({ requires_2fa: true, status: 200 }, { status: 200 });
    }

    return HttpResponse.json({
      ...mockUser,
      status: 200,
    });
  }),

  // Validate user
  http.get(`${BASE_URL}/app/validate`, ({ request }) => {
    const authHeader = request.headers.get("Authorization");

    if (!authHeader || authHeader === "Bearer invalid-token") {
      return HttpResponse.json({ detail: "Unauthorized" }, { status: 401 });
    }

    return HttpResponse.json(mockValidateResponse);
  }),

  // Logout
  http.post(`${BASE_URL}/app/logout`, () => {
    return HttpResponse.json({ success: true });
  }),

  // Get user
  http.get(`${BASE_URL}/app/user`, ({ request }) => {
    const authHeader = request.headers.get("Authorization");

    if (!authHeader) {
      return HttpResponse.json({ detail: "Unauthorized" }, { status: 401 });
    }

    return HttpResponse.json(mockUser);
  }),

  // Google auth
  http.post(`${BASE_URL}/app/google-auth`, async ({ request }) => {
    const body = (await request.json()) as { token: string };

    if (body.token === "invalid-google-token") {
      return HttpResponse.json({ detail: "Invalid Google token" }, { status: 401 });
    }

    return HttpResponse.json({ ...mockUser, status: 200 });
  }),

  // Microsoft auth
  http.post(`${BASE_URL}/app/microsoft-auth`, async ({ request }) => {
    const body = (await request.json()) as { token: string };

    if (body.token === "invalid-microsoft-token") {
      return HttpResponse.json({ detail: "Invalid Microsoft token" }, { status: 401 });
    }

    return HttpResponse.json({ ...mockUser, status: 200 });
  }),

  // Accept terms
  http.post(`${BASE_URL}/app/accepted-tos`, () => {
    return HttpResponse.json({ success: true });
  }),

  // 2FA endpoints
  http.post(`${BASE_URL}/totp`, () => {
    return HttpResponse.json({
      uri: "otpauth://totp/Workspace:test@example.com?secret=TESTSECRET",
      secret: "TESTSECRET",
    });
  }),

  http.post(`${BASE_URL}/totp/activate`, async ({ request }) => {
    const body = (await request.json()) as { totp_token: number };

    if (body.totp_token === 999999) {
      return HttpResponse.json({ detail: "Invalid code" }, { status: 400 });
    }

    return HttpResponse.json({ status: 200 });
  }),

  http.get(`${BASE_URL}/app/2fa`, () => {
    return HttpResponse.json({
      two_factor_auth: false,
      entity_require_authenticator: false,
    });
  }),

  http.put(`${BASE_URL}/app/2fa`, () => {
    return HttpResponse.json({ success: true });
  }),

  // ============ Dashboard Endpoints ============

  // Get dashboards
  http.get(`${BASE_URL}/app/dash/sync`, () => {
    return HttpResponse.json(mockDashboardData);
  }),

  // Get owned dashboards
  http.get(`${BASE_URL}/app/dash/sync/owned`, () => {
    return HttpResponse.json({ owned: mockDashboardData.owned });
  }),

  // Get shared dashboards
  http.get(`${BASE_URL}/app/dash/sync/shared`, () => {
    return HttpResponse.json({
      shared: mockDashboardData.shared,
      entity_shared: mockDashboardData.entity_shared,
    });
  }),

  // Post dashboards (sync)
  http.post(`${BASE_URL}/app/dash/sync`, async ({ request }) => {
    const body = await request.json();
    return HttpResponse.json({ success: true, items: body });
  }),

  // Share dashboard
  http.post(`${BASE_URL}/app/dash/:dashboardUuid/share`, async ({ params }) => {
    const { dashboardUuid } = params;

    if (dashboardUuid === "non-existent") {
      return HttpResponse.json({ detail: "Dashboard not found" }, { status: 404 });
    }

    return HttpResponse.json({ success: true });
  }),

  // Get dashboard shares
  http.get(`${BASE_URL}/app/dash/:dashboardUuid/shares`, ({ params }) => {
    const { dashboardUuid } = params;

    if (dashboardUuid === "non-existent") {
      return HttpResponse.json({ detail: "Dashboard not found" }, { status: 404 });
    }

    return HttpResponse.json({ shares: {} });
  }),

  // Delete dashboard share
  http.delete(`${BASE_URL}/app/dash/:dashboardUuid/share`, () => {
    return HttpResponse.json({ success: true });
  }),

  // ============ Usage & Tier Endpoints ============

  // Get usage
  http.get(`${BASE_URL}/app/usage`, () => {
    return HttpResponse.json(mockUsage);
  }),

  // ============ Widget Metadata Endpoints ============

  http.get(`${BASE_URL}/app/widget-metadata`, () => {
    return HttpResponse.json([]);
  }),

  http.post(`${BASE_URL}/app/widget-metadata`, () => {
    return HttpResponse.json({ success: true });
  }),

  http.patch(`${BASE_URL}/app/widget-metadata`, () => {
    return HttpResponse.json({ success: true });
  }),

  http.delete(`${BASE_URL}/app/widget-metadata/:widgetId`, () => {
    return HttpResponse.json([]);
  }),

  // ============ Data Connector Endpoints ============

  // API Sources
  http.get(`${BASE_URL}/app/data-connectors/api-source`, () => {
    return HttpResponse.json([]);
  }),

  http.post(`${BASE_URL}/app/data-connectors/api-source/:sourceUuid`, () => {
    return HttpResponse.json({ status: 200 });
  }),

  http.delete(`${BASE_URL}/app/data-connectors/api-source/:sourceUuid`, () => {
    return HttpResponse.json({ status: 200 });
  }),

  // File widgets
  http.get(`${BASE_URL}/app/data-connectors/file`, () => {
    return HttpResponse.json([]);
  }),

  http.post(`${BASE_URL}/app/data-connectors/file/:sourceUuid`, () => {
    return HttpResponse.json({ status: 200 });
  }),

  http.delete(`${BASE_URL}/app/data-connectors/file/:sourceUuid`, () => {
    return HttpResponse.json({ status: 200 });
  }),

  // ============ Files Endpoints ============

  http.get(`${BASE_URL}/app/files`, () => {
    return HttpResponse.json([]);
  }),

  http.get(`${BASE_URL}/app/files/:fileUuid/presigned-url`, ({ params }) => {
    const { fileUuid } = params;
    return HttpResponse.json({
      pre_signed_url: `https://storage.example.com/${fileUuid}`,
      stored_file_uuid: fileUuid as string,
      original_file_name: "test-file.csv",
    });
  }),

  http.delete(`${BASE_URL}/app/files/:fileUuid`, () => {
    return HttpResponse.json({ status: 200 });
  }),

  http.delete(`${BASE_URL}/app/files`, () => {
    return HttpResponse.json({ status: 200 });
  }),

  // ============ Copilot Endpoints ============

  http.get(`${BASE_URL}/app/copilot-chats`, () => {
    return HttpResponse.json({ chats: [] });
  }),

  http.post(`${BASE_URL}/app/copilot-chats`, () => {
    return HttpResponse.json(mockUsage);
  }),

  http.get(`${BASE_URL}/app/custom-copilot`, () => {
    return HttpResponse.json([]);
  }),

  http.put(`${BASE_URL}/app/custom-copilot`, () => {
    return HttpResponse.json({ success: true });
  }),

  http.delete(`${BASE_URL}/app/custom-copilot/:uuid`, () => {
    return HttpResponse.json({ success: true });
  }),

  // ============ Prompts Endpoints ============

  http.get(`${BASE_URL}/app/prompts`, () => {
    return HttpResponse.json([]);
  }),

  http.post(`${BASE_URL}/app/prompts`, () => {
    return HttpResponse.json({ success: true });
  }),

  // ============ Other Endpoints ============

  // User has entity
  http.get(`${BASE_URL}/app/user-has-entity`, () => {
    return HttpResponse.json({ success: true });
  }),

  // Theme settings
  http.get(`${BASE_URL}/app/theme-settings`, () => {
    return HttpResponse.json({ light: null, dark: null });
  }),

  // MCP servers
  http.post(`${BASE_URL}/app/mcp-servers`, () => {
    return HttpResponse.json({ status: 200 });
  }),

  // User update
  http.put(`${BASE_URL}/user`, () => {
    return HttpResponse.json({ status: 200 });
  }),

  // ============ Passthrough Handlers ============
  // Allow test URLs used by unit tests with vi.fn() mocks to pass through
  http.all("https://test-backend.com/*", () => passthrough()),
  http.all("http://test-backend.com/*", () => passthrough()),
  http.all("https://localhost/*", () => passthrough()),
  http.all("http://localhost/*", () => passthrough()),
];

// Helper to create custom handlers for specific test scenarios
export function createMockHandler(
  method: "get" | "post" | "put" | "delete" | "patch",
  path: string,
  response: JsonBodyType,
  status = 200,
) {
  const httpMethod = http[method];
  return httpMethod(`${BASE_URL}${path}`, () => {
    return HttpResponse.json(response, { status });
  });
}

// Helper to create error handler
export function createErrorHandler(
  method: "get" | "post" | "put" | "delete" | "patch",
  path: string,
  errorMessage: string,
  status = 500,
) {
  const httpMethod = http[method];
  return httpMethod(`${BASE_URL}${path}`, () => {
    return HttpResponse.json({ detail: errorMessage }, { status });
  });
}
