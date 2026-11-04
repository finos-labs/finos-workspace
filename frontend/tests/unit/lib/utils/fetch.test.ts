import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchFromSource,
  HEADERS_TIMEOUT_MS,
  isApiFileUrl,
  isApiUrl,
  isDefaultCopilotUrl,
  MAX_PROXIED_IN_FLIGHT,
  setSourceUrlLookup,
  sourceStreamHref,
} from "~/lib/utils/fetch";
import { mockConfig } from "../../../mocks/runtimeConfig";

describe("isApiUrl", () => {
  it.each([
    "http://localhost:3000/app/session",
    "http://localhost:3000",
    "/app/session",
    new URL("http://localhost:3000/totp"),
  ])("accepts the API's origin: %s", (url) => {
    expect(isApiUrl(url)).toBe(true);
  });

  it.each([
    "http://localhost:3000.evil.test/app/session",
    "http://evil.test/http://localhost:3000/app/session",
    "http://evil.test/?u=http://localhost:3000",
    "https://localhost:3000/app/session",
    "http://localhost:3001/app/session",
    "http://user@evil.test/",
  ])("refuses any other origin: %s", (url) => {
    expect(isApiUrl(url)).toBe(false);
  });
});

describe("isApiFileUrl", () => {
  afterEach(() => {
    mockConfig.urls.backend = "http://localhost:3000";
  });

  it.each([
    "http://localhost:3000/app/files/report.pdf",
    "/app/files/report.pdf",
  ])("accepts the API's file routes: %s", (url) => {
    expect(isApiFileUrl(url)).toBe(true);
  });

  it.each([
    "http://localhost:3000/app/logout",
    "http://localhost:3000/app/dash/validate-and-sync",
    "http://localhost:3000/app/files/../logout",
    "http://localhost:3000/app/filesystem",
    "http://localhost:3000.evil.test/app/files/report.pdf",
    "https://files.example.test/app/files/report.pdf",
  ])("refuses every other URL: %s", (url) => {
    expect(isApiFileUrl(url)).toBe(false);
  });

  it("follows an API served under a path", () => {
    mockConfig.urls.backend = "http://localhost:3000/api";

    expect(isApiFileUrl("http://localhost:3000/api/app/files/report.pdf")).toBe(true);
    expect(isApiFileUrl("http://localhost:3000/app/files/report.pdf")).toBe(false);
  });
});

describe("isDefaultCopilotUrl", () => {
  afterEach(() => {
    mockConfig.urls.ai = "http://localhost:3000/ai";
  });

  it.each([
    "http://localhost:3000/ai",
    "http://localhost:3000/ai/v1/query",
    "http://localhost:3000/ai/v1/generate/widget_info",
  ])("accepts AI_API_URL and the paths below it: %s", (url) => {
    expect(isDefaultCopilotUrl(url)).toBe(true);
  });

  it.each([
    "http://localhost:3000/aiagent/v1/query",
    "http://localhost:3000/app/user",
    "http://localhost:3000.evil.test/ai/v1/query",
    "https://agent.example.test/ai/v1/query",
  ])("refuses other agents and paths: %s", (url) => {
    expect(isDefaultCopilotUrl(url)).toBe(false);
  });

  it("accepts every path of an AI_API_URL at an origin's root", () => {
    mockConfig.urls.ai = "https://agent.example.test/";

    expect(isDefaultCopilotUrl("https://agent.example.test/v1/query")).toBe(true);
    expect(isDefaultCopilotUrl("https://other.example.test/v1/query")).toBe(false);
  });

  it("matches nothing when no default Copilot is configured", () => {
    mockConfig.urls.ai = "";

    expect(isDefaultCopilotUrl("http://localhost:3000/ai/v1/query")).toBe(false);
  });
});

describe("sourceStreamHref", () => {
  const stream = {
    url: "https://backend.test/v1/ws/ticks?symbol=A%26B",
    method: "GET" as const,
    paramHeaders: {},
  };

  afterEach(() => {
    setSourceUrlLookup(() => undefined);
    mockConfig.urls.backend = "http://localhost:3000";
  });

  it("opens a connection's socket through the API, which names the address and adds the credentials", () => {
    expect(sourceStreamHref({ ...stream, sourceId: "src-1" })).toBe(
      `http://localhost:3000/app/data-connectors/api-source/src-1/stream?url=${encodeURIComponent(stream.url)}`,
    );
  });

  it("follows an API served under a path", () => {
    mockConfig.urls.backend = "http://localhost:3000/api/";

    expect(sourceStreamHref({ ...stream, sourceId: "src-1" })).toMatch(
      /^http:\/\/localhost:3000\/api\/app\/data-connectors\/api-source\/src-1\/stream\?url=/,
    );
  });

  it("opens the address itself for a widget that has no connection", () => {
    expect(sourceStreamHref(stream)).toBe(stream.url);
  });

  it("opens an address off the connection's origin itself, with none of its credentials", () => {
    setSourceUrlLookup(() => "https://other.test/v1");

    expect(sourceStreamHref({ ...stream, sourceId: "src-1" })).toBe(stream.url);
  });
});

describe("requests the API makes to data backends for the page", () => {
  const source = { id: "src-1", url: "https://backend.test" };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function slowFetch() {
    const pending: Array<() => void> = [];
    let active = 0;
    let peak = 0;
    const fetchMock = vi.fn(
      (_url: string, _init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          active++;
          peak = Math.max(peak, active);
          pending.push(() => {
            active--;
            resolve(new Response("{}"));
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return {
      fetchMock,
      peak: () => peak,
      finishOne: () => pending.shift()?.(),
      queued: () => pending.length,
    };
  }

  it("are sent a few at a time, in order, however many the page asks for at once", async () => {
    const net = slowFetch();
    const all = Array.from({ length: 40 }, (_, i) =>
      fetchFromSource(source, `https://backend.test/file-${i}.json`),
    );
    await Promise.resolve();
    expect(net.fetchMock).toHaveBeenCalledTimes(MAX_PROXIED_IN_FLIGHT);
    for (let i = 0; i < 40; i++) {
      net.finishOne();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await Promise.all(all);
    expect(net.fetchMock).toHaveBeenCalledTimes(40);
    expect(net.peak()).toBe(MAX_PROXIED_IN_FLIGHT);
    const order = net.fetchMock.mock.calls.map(
      ([, init]) => JSON.parse(String(init?.body)).url,
    );
    expect(order[MAX_PROXIED_IN_FLIGHT]).toBe(
      `https://backend.test/file-${MAX_PROXIED_IN_FLIGHT}.json`,
    );
  });

  it("free their place when they fail, so that the others still go", async () => {
    const net = slowFetch();
    net.fetchMock.mockImplementationOnce(() => Promise.reject(new Error("offline")));
    const failed = fetchFromSource(source, "https://backend.test/a.json");
    await expect(failed).rejects.toThrow("offline");
    const next = Array.from({ length: MAX_PROXIED_IN_FLIGHT }, (_, i) =>
      fetchFromSource(source, `https://backend.test/b-${i}.json`),
    );
    await Promise.resolve();
    expect(net.fetchMock).toHaveBeenCalledTimes(1 + MAX_PROXIED_IN_FLIGHT);
    for (let i = 0; i < MAX_PROXIED_IN_FLIGHT; i++) net.finishOne();
    await Promise.all(next);
  });

  it("leave the queue when the page no longer wants them", async () => {
    const net = slowFetch();
    const running = Array.from({ length: MAX_PROXIED_IN_FLIGHT }, (_, i) =>
      fetchFromSource(source, `https://backend.test/r-${i}.json`),
    );
    const controller = new AbortController();
    const waiting = fetchFromSource(source, "https://backend.test/never.json", {
      signal: controller.signal,
    });
    controller.abort();
    await expect(waiting).rejects.toThrow();
    for (let i = 0; i < MAX_PROXIED_IN_FLIGHT; i++) net.finishOne();
    await Promise.all(running);
    expect(net.fetchMock).toHaveBeenCalledTimes(MAX_PROXIED_IN_FLIGHT);
    const again = fetchFromSource(source, "https://backend.test/again.json");
    await Promise.resolve();
    expect(net.fetchMock).toHaveBeenCalledTimes(MAX_PROXIED_IN_FLIGHT + 1);
    net.finishOne();
    await again;
  });

  it("give up on a backend that does not answer, and free their place", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          (_url: string, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () =>
                reject(init.signal?.reason),
              );
            }),
        ),
      );
      const waiting = fetchFromSource(source, "https://backend.test/slow.json");
      const settled = expect(waiting).rejects.toMatchObject({ name: "TimeoutError" });
      await vi.advanceTimersByTimeAsync(HEADERS_TIMEOUT_MS);
      await settled;

      const quick = vi.fn(() => Promise.resolve(new Response("{}")));
      vi.stubGlobal("fetch", quick);
      await fetchFromSource(source, "https://backend.test/next.json");
      expect(quick).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("can still be stopped by the page after their answer has started", async () => {
    let captured: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        captured = init?.signal ?? undefined;
        return Promise.resolve(new Response("{}"));
      }),
    );
    const controller = new AbortController();
    await fetchFromSource(source, "https://backend.test/stream.json", {
      signal: controller.signal,
    });
    expect(captured?.aborted).toBe(false);
    controller.abort();
    expect(captured?.aborted).toBe(true);
  });
});
