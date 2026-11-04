import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "~/api/api";
import { clearAgentToken, fetchAgent, getAgentToken } from "~/lib/state/agentToken";
import { setAgentHolders } from "~/lib/utils/fetch";
import { mockConfig } from "../../../mocks/runtimeConfig";

const AGENT_URL = "http://localhost:3000/ai/v1/query";
const MINUTE = 60 * 1000;

let minted = 0;

function mintAnswers(expiresIn = 1800) {
  vi.mocked(apiClient.post).mockImplementation(async () => {
    minted += 1;
    return { data: { token: `agent-token-${minted}`, expires_in: expiresIn } };
  });
}

const authOf = (call: unknown[]) =>
  new Headers((call[1] as RequestInit | undefined)?.headers).get("Authorization");

describe("agent token", () => {
  beforeEach(() => {
    minted = 0;
    mintAnswers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
  });

  afterEach(() => {
    setAgentHolders(() => []);
    clearAgentToken();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe("getAgentToken", () => {
    it("mints one token from the API and keeps it while plenty of time is left", async () => {
      expect(await getAgentToken()).toBe("agent-token-1");
      expect(await getAgentToken()).toBe("agent-token-1");

      expect(apiClient.post).toHaveBeenCalledTimes(1);
      expect(apiClient.post).toHaveBeenCalledWith("/app/copilot/token");
    });

    it("shares one mint between concurrent callers", async () => {
      const tokens = await Promise.all([
        getAgentToken(),
        getAgentToken(),
        getAgentToken(),
      ]);

      expect(tokens).toEqual(["agent-token-1", "agent-token-1", "agent-token-1"]);
      expect(apiClient.post).toHaveBeenCalledTimes(1);
    });

    it("renews the token once less than 20 minutes are left", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      await getAgentToken();

      vi.advanceTimersByTime(9 * MINUTE);
      expect(await getAgentToken()).toBe("agent-token-1");

      vi.advanceTimersByTime(2 * MINUTE);
      expect(await getAgentToken()).toBe("agent-token-2");
    });

    it("mints a new token when asked to renew", async () => {
      await getAgentToken();

      expect(await getAgentToken(true)).toBe("agent-token-2");
    });

    it("forgets the token on sign-out, even one still being minted", async () => {
      const pending = getAgentToken();
      clearAgentToken();
      await pending;

      expect(await getAgentToken()).toBe("agent-token-2");
    });

    it("keeps the token out of browser storage", async () => {
      localStorage.clear();
      sessionStorage.clear();

      await getAgentToken();

      expect(localStorage.length).toBe(0);
      expect(sessionStorage.length).toBe(0);
    });
  });

  describe("fetchAgent", () => {
    it("calls the default Copilot with the agent token as its bearer", async () => {
      const callerHeaders = { "Content-Type": "application/json" };

      await fetchAgent(AGENT_URL, {
        method: "POST",
        headers: callerHeaders,
        body: "{}",
      });

      const call = vi.mocked(fetch).mock.calls[0];
      expect(call[0]).toBe(AGENT_URL);
      expect(authOf(call)).toBe("Bearer agent-token-1");
      expect(new Headers(call[1]?.headers).get("Content-Type")).toBe(
        "application/json",
      );
      expect(callerHeaders).toEqual({ "Content-Type": "application/json" });
    });

    it("retries once with a fresh token after a 401", async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(new Response("", { status: 401 }))
        .mockResolvedValueOnce(new Response("{}", { status: 200 }));

      const response = await fetchAgent(AGENT_URL, { method: "POST" });

      expect(response.status).toBe(200);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(authOf(vi.mocked(fetch).mock.calls[0])).toBe("Bearer agent-token-1");
      expect(authOf(vi.mocked(fetch).mock.calls[1])).toBe("Bearer agent-token-2");
    });

    it("gives up after the one retry", async () => {
      vi.mocked(fetch).mockImplementation(
        async () => new Response("", { status: 401 }),
      );

      const response = await fetchAgent(AGENT_URL, { method: "POST" });

      expect(response.status).toBe(401);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    describe("an agent whose credentials the API keeps", () => {
      const holders = [
        { uuid: "holder-root", url: "https://agent.example.test" },
        { uuid: "holder-api", url: "https://agent.example.test/api" },
        { uuid: "holder-other", url: "https://other.example.test" },
      ];

      beforeEach(() => setAgentHolders(() => holders));

      it("goes through the API's relay with only the session and what the caller set", async () => {
        const body = JSON.stringify({ messages: [] });

        await fetchAgent("https://other.example.test/v1/query?x=1", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Trace-Id": "chat-1" },
          body,
        });

        const [url, init] = vi.mocked(fetch).mock.calls[0];
        expect(url).toBe(
          `${mockConfig.urls.backend}/app/custom-copilot/holder-other/relay?target=${encodeURIComponent("https://other.example.test/v1/query?x=1")}`,
        );
        expect(init?.method).toBe("POST");
        expect(init?.body).toBe(body);
        expect(init?.credentials).toBe("include");
        const headers = new Headers(init?.headers);
        expect(headers.get("X-Workspace-Client")).toBe("web");
        expect(headers.get("X-Trace-Id")).toBe("chat-1");
        expect(headers.get("Authorization")).toBeNull();
        expect(apiClient.post).not.toHaveBeenCalled();
      });

      it("picks the holder whose address is the longest prefix of the target", async () => {
        await fetchAgent("https://agent.example.test/api/v1/query", { method: "POST" });
        await fetchAgent("https://agent.example.test/elsewhere/query", {
          method: "POST",
        });

        const [first, second] = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
        expect(first).toContain("/custom-copilot/holder-api/relay");
        expect(second).toContain("/custom-copilot/holder-root/relay");
      });

      it("goes straight to an address no holder owns", async () => {
        const init = { method: "POST" };

        await fetchAgent("https://stranger.example.test/v1/query", init);

        expect(fetch).toHaveBeenCalledWith(
          "https://stranger.example.test/v1/query",
          init,
        );
      });

      it("leaves the default Copilot to its own token", async () => {
        await fetchAgent(AGENT_URL, { method: "POST" });

        expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe(AGENT_URL);
        expect(authOf(vi.mocked(fetch).mock.calls[0])).toBe("Bearer agent-token-1");
      });
    });

    it.each([
      "https://agent.example.test/v1/query",
      "http://localhost:3000/app/user",
      "http://localhost:3000.evil.test/ai/v1/query",
    ])("sends no FINOS Workspace credential to any other URL: %s", async (url) => {
      const init = { method: "POST", headers: { "X-Agent-Key": "agent-key" } };

      await fetchAgent(url, init);

      expect(fetch).toHaveBeenCalledWith(url, init);
      expect(authOf(vi.mocked(fetch).mock.calls[0])).toBeNull();
      expect(apiClient.post).not.toHaveBeenCalled();
    });
  });
});
