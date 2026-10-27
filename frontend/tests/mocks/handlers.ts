import { HttpResponse, http, passthrough } from "msw";
import type { Usage, UserAccess } from "~/lib/state/access";

export const mockUser = {
  uuid: "test-user-uuid",
  email: "test@example.com",
  first_name: "Test",
  last_name: "User",
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

export const mockUsage: Usage = {
  number_copilot_calls_day_count: 10,
  number_copilot_tokens_day_count: 0,
  total_file_upload_size_gb_count: 5,
  copilot_calls_limit: 100,
  copilot_tokens_limit: null,
  file_upload_size_limit: 50,
};

export const mockAccess: UserAccess = {
  user_type: "User",
  sharing: "none",
};

export const mockSession = {
  uuid: mockUser.uuid,
  email: mockUser.email,
  entity_name: null,
  role: null,
  access: mockAccess,
  user: {
    first_name: mockUser.first_name,
    last_name: mockUser.last_name,
    display_settings: { lastVisitedPage: "/app" },
  },
};

export const mockCopilotKeys = { has_openai_key: false, has_perplexity_key: false };

const isWebClient = (request: Request) =>
  request.headers.get("X-Workspace-Client") === "web";

const unauthorized = () =>
  HttpResponse.json({ detail: "Not authenticated" }, { status: 401 });

const BASE_URL = "https://backend.test";

export const handlers = [
  http.post(`${BASE_URL}/app/login`, async ({ request }) => {
    const body = (await request.json()) as { email: string; password: string };

    if (body.email === "invalid@example.com") {
      return HttpResponse.json({ detail: "Invalid credentials" }, { status: 401 });
    }

    if (body.email === "2fa@example.com") {
      return HttpResponse.json(
        { two_factor_required: true, message: "Two-factor authentication is required" },
        { status: 202 },
      );
    }

    return HttpResponse.json({
      ...mockUser,
      status: 200,
    });
  }),

  http.get(`${BASE_URL}/app/validate`, ({ request }) =>
    isWebClient(request) ? HttpResponse.json(mockValidateResponse) : unauthorized(),
  ),

  http.get(`${BASE_URL}/app/session`, ({ request }) =>
    isWebClient(request) ? HttpResponse.json(mockSession) : unauthorized(),
  ),

  http.post(`${BASE_URL}/app/copilot/token`, ({ request }) =>
    isWebClient(request)
      ? HttpResponse.json({ token: "mock-agent-token", expires_in: 1800 })
      : unauthorized(),
  ),

  http.get(`${BASE_URL}/app/copilot-keys`, ({ request }) =>
    isWebClient(request) ? HttpResponse.json(mockCopilotKeys) : unauthorized(),
  ),

  http.put(`${BASE_URL}/app/copilot-keys`, async ({ request }) => {
    if (!isWebClient(request)) return unauthorized();
    const body = (await request.json()) as {
      openai_api_key?: string | null;
      perplexity_api_key?: string | null;
    };
    return HttpResponse.json({
      has_openai_key:
        body.openai_api_key === undefined
          ? mockCopilotKeys.has_openai_key
          : body.openai_api_key !== null,
      has_perplexity_key:
        body.perplexity_api_key === undefined
          ? mockCopilotKeys.has_perplexity_key
          : body.perplexity_api_key !== null,
    });
  }),

  http.post(`${BASE_URL}/app/logout`, () => {
    return HttpResponse.json({ success: true });
  }),

  http.post(`${BASE_URL}/app/google-auth`, async ({ request }) => {
    const body = (await request.json()) as { token: string };

    if (body.token === "invalid-google-token") {
      return HttpResponse.json({ detail: "Invalid Google token" }, { status: 401 });
    }

    return HttpResponse.json({ ...mockUser, status: 200 });
  }),

  http.post(`${BASE_URL}/app/microsoft-auth`, async ({ request }) => {
    const body = (await request.json()) as { token: string; id_token?: string };

    if (body.token === "invalid-microsoft-token" || !body.id_token) {
      return HttpResponse.json({ detail: "Invalid Microsoft token" }, { status: 401 });
    }

    return HttpResponse.json({ ...mockUser, status: 200 });
  }),

  http.post(`${BASE_URL}/app/okta-auth`, async ({ request }) => {
    const body = (await request.json()) as { token: string; id_token?: string };

    if (!body.id_token) {
      return HttpResponse.json({ detail: "Invalid Okta token" }, { status: 401 });
    }

    return HttpResponse.json({ ...mockUser, status: 200 });
  }),

  http.post(`${BASE_URL}/app/accepted-tos`, () => {
    return HttpResponse.json({ success: true });
  }),

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

  http.get(`${BASE_URL}/app/dash/sync`, () => {
    return HttpResponse.json(mockDashboardData);
  }),

  http.get(`${BASE_URL}/app/dash/sync/owned`, () => {
    return HttpResponse.json({ owned: mockDashboardData.owned });
  }),

  http.get(`${BASE_URL}/app/dash/sync/shared`, () => {
    return HttpResponse.json({
      shared: mockDashboardData.shared,
      entity_shared: mockDashboardData.entity_shared,
    });
  }),

  http.post(`${BASE_URL}/app/dash/sync`, async ({ request }) => {
    const body = await request.json();
    return HttpResponse.json({ success: true, items: body });
  }),

  http.post(`${BASE_URL}/app/dash/:dashboardUuid/share`, async ({ params }) => {
    const { dashboardUuid } = params;

    if (dashboardUuid === "non-existent") {
      return HttpResponse.json({ detail: "Dashboard not found" }, { status: 404 });
    }

    return HttpResponse.json({ success: true });
  }),

  http.get(`${BASE_URL}/app/dash/:dashboardUuid/shares`, ({ params }) => {
    const { dashboardUuid } = params;

    if (dashboardUuid === "non-existent") {
      return HttpResponse.json({ detail: "Dashboard not found" }, { status: 404 });
    }

    return HttpResponse.json({ shares: {} });
  }),

  http.delete(`${BASE_URL}/app/dash/:dashboardUuid/share`, () => {
    return HttpResponse.json({ success: true });
  }),

  http.get(`${BASE_URL}/app/usage`, () => {
    return HttpResponse.json(mockUsage);
  }),

  http.get(`${BASE_URL}/app/access`, () => {
    return HttpResponse.json(mockAccess);
  }),

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

  http.get(`${BASE_URL}/app/data-connectors/api-source`, () => {
    return HttpResponse.json([]);
  }),

  http.post(`${BASE_URL}/app/data-connectors/api-source/:sourceUuid`, () => {
    return HttpResponse.json({ status: 200 });
  }),

  http.delete(`${BASE_URL}/app/data-connectors/api-source/:sourceUuid`, () => {
    return HttpResponse.json({ status: 200 });
  }),

  http.get(`${BASE_URL}/app/data-connectors/file`, () => {
    return HttpResponse.json([]);
  }),

  http.post(`${BASE_URL}/app/data-connectors/file/:sourceUuid`, () => {
    return HttpResponse.json({ status: 200 });
  }),

  http.delete(`${BASE_URL}/app/data-connectors/file/:sourceUuid`, () => {
    return HttpResponse.json({ status: 200 });
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

  http.get(`${BASE_URL}/app/prompts`, () => {
    return HttpResponse.json([]);
  }),

  http.post(`${BASE_URL}/app/prompts`, () => {
    return HttpResponse.json({ success: true });
  }),

  http.get(`${BASE_URL}/app/theme-settings`, () => {
    return HttpResponse.json({ light: null, dark: null });
  }),

  http.post(`${BASE_URL}/app/mcp-servers`, () => {
    return HttpResponse.json({ status: 200 });
  }),

  http.put(`${BASE_URL}/user`, () => {
    return HttpResponse.json({ status: 200 });
  }),

  http.all("https://test-backend.com/*", () => passthrough()),
  http.all("http://test-backend.com/*", () => passthrough()),
  http.all("https://localhost/*", () => passthrough()),
  http.all("http://localhost/*", () => passthrough()),
];
