import { afterEach, beforeEach, describe, it } from "node:test";
import { expect } from "expect";
import { createApp } from "../../../src/app.ts";
import { createLimits } from "../../../src/auth/limits.ts";
import type { WorkspaceClient } from "../../../src/auth/workspace-client.ts";
import { loadConfig } from "../../../src/lib/config.ts";
import { createLocalStore } from "../../../src/lib/store.ts";
import { MAX_AUDIO_BYTES } from "../../../src/routes/transcribe.ts";
import { wav } from "../../helpers/wav.ts";

const ENV = {
  WORKSPACE_API_URL: "http://api:8000",
  WORKSPACE_ORIGIN: "http://localhost:3000",
  AGENT_METERING_TOKEN: "metering-token",
  AGENT_SCOPE_SECRET: "0123456789abcdef0123",
  AGENT_CORS_ORIGINS: "http://localhost:3000",
};

function app(extraEnv: Record<string, string> = {}) {
  const workspace: WorkspaceClient = {
    getUser: async (token) => (token === "alice-token" ? { ok: true, value: { userId: "alice" } } : { ok: false, reason: "rejected" }),
    recordQuery: async () => ({ ok: true, value: undefined }),
    recordTokens: async () => {},
    authorize: async () => ({ ok: true, value: { allowed: true, deniedModel: null, deniedTools: [], disabledCapabilities: [] } }),
    ready: async () => true,
  };
  const config = loadConfig({ ...ENV, ...extraEnv });
  const store = createLocalStore();
  return createApp({
    config,
    workspace,
    store,
    limits: createLimits({ store, maxConcurrent: config.maxConcurrentQueries, maxHelperCallsPerMinute: config.maxHelperCallsPerMinute }),
  });
}

function send(target: ReturnType<typeof app>, audio: Uint8Array<ArrayBuffer> | string | null, token: string | null = "alice-token") {
  const form = new FormData();
  if (audio !== null) form.set("audio", new File([audio], "dictation.wav", { type: "audio/wav" }));
  return target.request("/v1/transcribe", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
}

const realFetch = globalThis.fetch;
const saved = { model: process.env.AGENT_TRANSCRIBE_MODEL, key: process.env.GROQ_API_KEY };
let asked = 0;

beforeEach(() => {
  process.env.AGENT_TRANSCRIBE_MODEL = "groq:whisper-large-v3-turbo";
  process.env.GROQ_API_KEY = "gsk-test";
  asked = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).startsWith("https://api.groq.com/")) {
      asked++;
      return Response.json({ text: "Show me the revenue of Apple.", x_groq: { id: "req_1" } });
    }
    return realFetch(input as string, init);
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const [name, value] of [["AGENT_TRANSCRIBE_MODEL", saved.model], ["GROQ_API_KEY", saved.key]] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("POST /v1/transcribe", () => {
  it("answers a signed-in user's recording with its text", async () => {
    const res = await send(app(), wav());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "Show me the revenue of Apple." });
    expect(asked).toBe(1);
  });

  it("is for signed-in users only", async () => {
    expect((await send(app(), wav(), null)).status).toBe(401);
    expect(asked).toBe(0);
  });

  it("is not there when the deployment has no speech-to-text model", async () => {
    delete process.env.AGENT_TRANSCRIBE_MODEL;
    expect((await send(app(), wav())).status).toBe(404);
  });

  it("takes a 16-bit PCM WAV, and nothing else, without asking the model", async () => {
    expect((await send(app(), null)).status).toBe(400);
    expect((await send(app(), "not audio, just some words that are not a recording")).status).toBe(400);
    expect((await send(app(), wav({ bits: 8 }))).status).toBe(400);
    expect(asked).toBe(0);
  });

  it("refuses a recording longer than the web app makes", async () => {
    const res = await send(app(), wav({ samples: MAX_AUDIO_BYTES / 2 + 1 }));
    expect(res.status).toBe(413);
    expect(asked).toBe(0);
  });

  it("says the transcription failed, without the provider's words, when the provider fails", async () => {
    globalThis.fetch = (async () => new Response("upstream refused with its own words", { status: 401 })) as unknown as typeof fetch;
    const res = await send(app(), wav());
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Speech to text failed. Try again." });
  });

  it("counts against the user's helper calls", async () => {
    const limited = app({ AGENT_HELPER_CALLS_PER_MINUTE: "1" });
    expect((await send(limited, wav())).status).toBe(200);
    expect((await send(limited, wav())).status).toBe(429);
  });
});

describe("the speech-to-text feature in /agents.json", () => {
  const features = async () =>
    ((await (await app().request("/agents.json")).json()) as { default_agent: { features: Record<string, unknown> } }).default_agent.features;

  it("is on when the deployment has a speech-to-text model, and absent when it has none", async () => {
    expect((await features())["speech-to-text"]).toBe(true);
    delete process.env.AGENT_TRANSCRIBE_MODEL;
    expect(await features()).not.toHaveProperty("speech-to-text");
  });
});

describe("loadConfig", () => {
  it("refuses an AGENT_TRANSCRIBE_MODEL it cannot use", () => {
    expect(() => loadConfig({ ...ENV, AGENT_TRANSCRIBE_MODEL: "ollama:whisper" })).toThrow("provider that transcribes");
  });
});
