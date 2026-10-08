import type { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "~/api/api";
import type { AuthState } from "~/lib/state/auth";

vi.unmock("~/api/api");

// Global mocks
const mockLogout = vi.fn();

const mockAuthState = {
  user: { token: "test-token" },
  logout: mockLogout,
} as unknown as AuthState;

type InterceptorHandler<V> = {
  fulfilled: (value: V) => V | Promise<V>;
  rejected: (error: AxiosError) => unknown;
};

// The mocked axios instance below records the interceptors that get registered on it.
const requestHandlers = () =>
  (
    apiClient.interceptors.request as unknown as {
      handlers: InterceptorHandler<InternalAxiosRequestConfig>[];
    }
  ).handlers;
const responseHandlers = () =>
  (
    apiClient.interceptors.response as unknown as {
      handlers: InterceptorHandler<AxiosResponse>[];
    }
  ).handlers;

vi.mock("~/lib/state/auth", () => {
  return {
    useAuthStore: {
      getState: vi.fn(() => mockAuthState),
    },
  };
});

vi.mock("axios", () => {
  const axiosInstance = {
    interceptors: {
      request: {
        use: vi.fn((fulfilled: unknown) => {
          axiosInstance.interceptors.request.handlers.push({ fulfilled });
        }),
        handlers: [] as { fulfilled?: unknown; rejected?: unknown }[],
      },
      response: {
        use: vi.fn((fulfilled: unknown, rejected: unknown) => {
          axiosInstance.interceptors.response.handlers.push({ fulfilled, rejected });
        }),
        handlers: [] as { fulfilled?: unknown; rejected?: unknown }[],
      },
    },
    get: vi.fn(),
    post: vi.fn(),
  };

  const axiosMock = {
    create: vi.fn(() => axiosInstance),
    isAxiosError: vi.fn(),
    ...axiosInstance,
  };

  return {
    default: axiosMock,
  };
});

const mockConsoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("apiClient", () => {
  it("should add Authorization header if user token exists", async () => {
    const requestConfig = await requestHandlers()[0].fulfilled({
      headers: {},
      method: "get",
      url: "/test",
    } as InternalAxiosRequestConfig);

    expect(requestConfig.headers.Authorization).toBe("Bearer test-token");
  });

  it("strips an explicitly empty per-request Authorization header (opts out of auth)", async () => {
    // Real AxiosHeaders (the axios module is mocked above): in production the
    // interceptor receives the merged per-request headers as an AxiosHeaders
    // instance. `headers: { authorization: "" }` must result in NO header on
    // the wire — an empty Authorization header would still trigger a CORS
    // preflight, which the marketplace host rejects.
    const { AxiosHeaders } = await vi.importActual<typeof import("axios")>("axios");
    const requestConfig = await requestHandlers()[0].fulfilled({
      headers: new AxiosHeaders({ authorization: "" }),
      method: "get",
      url: "/marketplace/apps",
    } as InternalAxiosRequestConfig);

    expect(requestConfig.headers.has("Authorization")).toBe(false);
  });

  it("should log request details in development mode", async () => {
    import.meta.env.DEV = true;
    await requestHandlers()[0].fulfilled({
      headers: {},
      method: "get",
      url: "/test",
    } as InternalAxiosRequestConfig);

    expect(mockConsoleInfo).toHaveBeenCalledWith("[API req]", "[Authed]", "GET /test");
  });

  it("should log response details in development mode", async () => {
    import.meta.env.DEV = true;
    const response = {
      status: 200,
      config: { url: "/test" },
      data: {},
    } as AxiosResponse;
    await responseHandlers()[0].fulfilled(response);

    expect(mockConsoleInfo).toHaveBeenCalledWith("[API res] 200 /test", {}, response);
  });

  it("should log error details and logout on 401 status", async () => {
    import.meta.env.DEV = true;
    const error = {
      response: { status: 401, config: { url: "/test" } },
      config: { url: "/test" },
    };

    await expect(responseHandlers()[0].rejected(error as AxiosError)).rejects.toEqual(
      error,
    );
    expect(mockConsoleInfo).toHaveBeenCalledWith("[API err] 401 /test", error);
    expect(mockConsoleInfo).toHaveBeenCalledTimes(1);
    expect(mockLogout).toHaveBeenCalled();
  });
});
