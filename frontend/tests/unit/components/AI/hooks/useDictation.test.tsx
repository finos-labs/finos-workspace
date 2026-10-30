import { act, renderHook, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transcribeUrl, useDictation } from "~/components/AI/hooks/useDictation";
import type { Copilot } from "~/lib/state/copilot";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn() },
}));

vi.mock("~/components/AI/hooks/useGetCopilotRequestHeaders", () => ({
  useGetCopilotRequestHeaders: () => () => ({
    "Content-Type": "application/json",
    "X-Trace-Id": "chat-1",
  }),
}));

vi.mock("~/lib/state/agentToken", () => ({
  fetchAgent: (input: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", "Bearer agent-token");
    return fetch(input, { ...init, headers });
  },
}));

const agent = {
  id: "default-copilot",
  endpoints: { query: "http://agent:7777/v1/query" },
  features: { "speech-to-text": true },
} as unknown as Copilot;

const stopTrack = vi.fn();
let getUserMedia: ReturnType<typeof vi.fn>;

class FakeRecorder {
  static last: FakeRecorder;
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor() {
    FakeRecorder.last = this;
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["recorded"], { type: "audio/webm" }) });
    this.onstop?.();
  }
}

class FakeAudioContext {
  async decodeAudioData() {
    return { duration: 0.01 };
  }
  close() {}
}

class FakeOfflineAudioContext {
  destination = {};
  constructor(
    public channels: number,
    public length: number,
    public sampleRate: number,
  ) {}
  createBufferSource() {
    return { buffer: null, connect: vi.fn(), start: vi.fn() };
  }
  async startRendering() {
    return { getChannelData: () => new Float32Array(this.length) };
  }
}

const realFetch = globalThis.fetch;
let sent: { url: string; init: RequestInit }[];
let answer: () => Response;

beforeEach(() => {
  vi.clearAllMocks();
  sent = [];
  answer = () => Response.json({ text: " Show me the revenue of Apple. " });
  getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] }));
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia },
    configurable: true,
  });
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("OfflineAudioContext", FakeOfflineAudioContext);
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), init: init ?? {} });
    return answer();
  }) as typeof fetch;
});

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.fetch = realFetch;
});

describe("transcribeUrl", () => {
  it("is the agent's /v1/transcribe, next to its /v1/query", () => {
    expect(transcribeUrl(agent)).toBe("http://agent:7777/v1/transcribe");
    expect(transcribeUrl({ ...agent, endpoints: {} } as Copilot)).toBeNull();
    expect(transcribeUrl(null)).toBeNull();
  });
});

describe("useDictation", () => {
  async function dictate() {
    const onText = vi.fn();
    const { result } = renderHook(() => useDictation(agent, onText));
    await act(() => result.current.start());
    expect(result.current.state).toBe("recording");
    act(() => result.current.stop());
    await waitFor(() => expect(result.current.state).toBe("idle"));
    return onText;
  }

  it("asks the browser for the microphone, sends the recording as WAV, and gives back the text", async () => {
    const onText = await dictate();

    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(stopTrack).toHaveBeenCalled();
    expect(onText).toHaveBeenCalledWith("Show me the revenue of Apple.");

    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("http://agent:7777/v1/transcribe");
    const headers = new Headers(sent[0].init.headers);
    expect(headers.get("Authorization")).toBe("Bearer agent-token");
    expect(headers.get("X-Trace-Id")).toBe("chat-1");
    expect(headers.has("Content-Type")).toBe(false);
    const audio = (sent[0].init.body as FormData).get("audio") as File;
    expect(audio.type).toBe("audio/wav");
    const bytes = new Uint8Array(await audio.arrayBuffer());
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe("RIFF");
    expect(new DataView(bytes.buffer).getUint32(24, true)).toBe(16_000);
  });

  it("says so, and records nothing, when the microphone is refused", async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
    const { result } = renderHook(() => useDictation(agent, vi.fn()));

    await act(() => result.current.start());

    expect(result.current.state).toBe("idle");
    expect(toast.error).toHaveBeenCalledWith(
      "Allow the microphone in your browser to use voice input.",
    );
    expect(sent).toHaveLength(0);
  });

  it("says when there is no microphone", async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException("none", "NotFoundError"));
    const { result } = renderHook(() => useDictation(agent, vi.fn()));

    await act(() => result.current.start());

    expect(toast.error).toHaveBeenCalledWith("No microphone was found.");
  });

  it("says when nothing was heard, and puts nothing in the question", async () => {
    answer = () => Response.json({ text: "   " });
    const onText = await dictate();

    expect(onText).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith("No speech was heard.");
  });

  it("says when the agent could not transcribe", async () => {
    answer = () =>
      Response.json({ error: "Speech to text failed. Try again." }, { status: 502 });
    const onText = await dictate();

    expect(onText).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Speech to text failed. Try again.");
  });

  it("sends nothing when the chat goes away while it records", async () => {
    const { result, unmount } = renderHook(() => useDictation(agent, vi.fn()));
    await act(() => result.current.start());

    unmount();

    expect(stopTrack).toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });
});
