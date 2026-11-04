import {
  type AxiosError,
  AxiosHeaders,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient, setOnSessionRefused } from "~/api/api";

vi.unmock("~/api/api");

const sessionRefused = vi.fn();

type InterceptorHandler<V> = {
  fulfilled: (value: V) => V | Promise<V>;
  rejected: (error: AxiosError) => unknown;
};

const requestHandler = () =>
  (
    apiClient.interceptors.request as unknown as {
      handlers: InterceptorHandler<InternalAxiosRequestConfig>[];
    }
  ).handlers[0];
const responseHandler = () =>
  (
    apiClient.interceptors.response as unknown as {
      handlers: InterceptorHandler<AxiosResponse>[];
    }
  ).handlers[0];

function send(config: Partial<InternalAxiosRequestConfig>) {
  return requestHandler().fulfilled({
    headers: new AxiosHeaders(),
    method: "get",
    ...config,
  } as InternalAxiosRequestConfig);
}

function refusal(status: number, url: string, baseURL?: string) {
  return {
    response: { status, config: { url } },
    config: { url, baseURL, headers: new AxiosHeaders() },
  } as unknown as AxiosError;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => {});
  setOnSessionRefused(sessionRefused);
});

describe("apiClient requests", () => {
  it("sends the session cookie and the client header to the API", async () => {
    const config = await send({ url: "/app/session" });

    expect(config.baseURL).toBe("http://localhost:3000");
    expect(config.withCredentials).toBe(true);
    expect(config.headers.get("X-Workspace-Client")).toBe("web");
    expect(config.headers.has("Authorization")).toBe(false);
  });

  it("sends no FINOS Workspace credential or client header to another origin", async () => {
    const config = await send({
      url: "https://agent.example.test/upload",
      headers: new AxiosHeaders({ "X-Workspace-Client": "web" }),
    });

    expect(config.withCredentials).toBe(false);
    expect(config.headers.has("X-Workspace-Client")).toBe(false);
    expect(config.headers.has("Authorization")).toBe(false);
  });

  it("sends nothing to a base URL on another origin", async () => {
    const config = await send({
      url: "/app/user",
      baseURL: "https://elsewhere.test",
    });

    expect(config.withCredentials).toBe(false);
    expect(config.headers.has("X-Workspace-Client")).toBe(false);
  });

  it.each([
    "http://localhost:3000.evil.test/app/user",
    "http://evil.test/?next=http://localhost:3000",
    "http://evil.test/http://localhost:3000/app/user",
    "https://localhost:3000/app/user",
    "http://localhost:30001/app/user",
  ])("compares the exact origin, not a substring: %s", async (url) => {
    const config = await send({ url });

    expect(config.withCredentials).toBe(false);
    expect(config.headers.has("X-Workspace-Client")).toBe(false);
  });

  it("logs requests in development mode", async () => {
    import.meta.env.DEV = true;
    await send({ url: "/test" });

    expect(console.info).toHaveBeenCalledWith("[API req]", "GET /test");
  });

  it("logs responses in development mode", async () => {
    import.meta.env.DEV = true;
    const response = {
      status: 200,
      config: { url: "/test" },
      data: {},
    } as AxiosResponse;
    await responseHandler().fulfilled(response);

    expect(console.info).toHaveBeenCalledWith("[API res] 200 /test", {}, response);
  });
});

describe("apiClient refusals", () => {
  it("tells the auth store when the API refuses the session", async () => {
    const error = refusal(401, "/app/dash/validate-and-sync");

    await expect(responseHandler().rejected(error)).rejects.toBe(error);
    expect(sessionRefused).toHaveBeenCalledTimes(1);
  });

  it("does not sign out on a 401 from another origin", async () => {
    const error = refusal(401, "https://agent.example.test/query");

    await expect(responseHandler().rejected(error)).rejects.toBe(error);
    expect(sessionRefused).not.toHaveBeenCalled();
  });

  it("does not sign out again when signing out itself is refused", async () => {
    const error = refusal(401, "/app/logout");

    await expect(responseHandler().rejected(error)).rejects.toBe(error);
    expect(sessionRefused).not.toHaveBeenCalled();
  });

  it("does not sign out on other errors", async () => {
    const error = refusal(403, "/app/admin");

    await expect(responseHandler().rejected(error)).rejects.toBe(error);
    expect(sessionRefused).not.toHaveBeenCalled();
  });
});
