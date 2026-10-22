import { afterEach, describe, it } from "node:test";
import { expect } from "expect";
import { readWav, transcribe, transcribeModel, transcribeModelProblem } from "../../../../src/lib/transcribe.ts";
import { wav } from "../../../helpers/wav.ts";

describe("INES_TRANSCRIBE_MODEL", () => {
  it("is optional: unset, there is no dictation and nothing is wrong", () => {
    expect(transcribeModel({})).toBeNull();
    expect(transcribeModelProblem({})).toBeNull();
  });

  it("names a provider that transcribes, with its key", () => {
    expect(transcribeModelProblem({ INES_TRANSCRIBE_MODEL: "nvidia:openai/whisper-large-v3", NVIDIA_API_KEY: "k" })).toBeNull();
    expect(transcribeModelProblem({ INES_TRANSCRIBE_MODEL: "groq:whisper-large-v3-turbo", GROQ_API_KEY: "k" })).toBeNull();
    expect(transcribeModelProblem({ INES_TRANSCRIBE_MODEL: "openai:gpt-4o-mini-transcribe", OPENAI_API_KEY: "k" })).toBeNull();
    expect(transcribeModelProblem({ INES_TRANSCRIBE_MODEL: "ollama:whisper" })).toContain("groq, openai, nvidia");
    expect(transcribeModelProblem({ INES_TRANSCRIBE_MODEL: "whisper" })).toContain("<provider>:<model>");
    expect(transcribeModelProblem({ INES_TRANSCRIBE_MODEL: "nvidia:openai/whisper-large-v3" })).toBe(
      "INES_TRANSCRIBE_MODEL names nvidia, which needs NVIDIA_API_KEY.",
    );
  });
});

describe("readWav", () => {
  it("reads the rate and channels of a 16-bit PCM WAV, past other chunks", () => {
    expect(readWav(wav())).toMatchObject({ sampleRate: 16_000, channels: 1 });
    expect(readWav(wav({ sampleRate: 48_000, channels: 2, extraChunk: true }))).toMatchObject({ sampleRate: 48_000, channels: 2 });
  });

  it("refuses what is not a 16-bit PCM WAV", () => {
    expect(readWav(new TextEncoder().encode("not audio at all, just some words in a file"))).toBeNull();
    expect(readWav(wav({ bits: 8 }))).toBeNull();
    expect(readWav(wav({ format: 3, bits: 32 }))).toBeNull(); // float
    expect(readWav(wav({ samples: 0 }))).toBeNull();
    expect(readWav(wav().subarray(0, 30))).toBeNull();
  });
});

describe("transcribe", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("asks Groq for a groq: model, with the recording", async () => {
    const asked: { url: string; file?: Blob | null }[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      asked.push({ url: String(input), file: (init?.body as FormData).get("file") as Blob });
      return Response.json({ text: " Show me the revenue of Apple. ", x_groq: { id: "req_1" } });
    }) as typeof fetch;
    const text = await transcribe(readWav(wav())!, undefined, { INES_TRANSCRIBE_MODEL: "groq:whisper-large-v3-turbo", GROQ_API_KEY: "gsk" });
    expect(text).toBe("Show me the revenue of Apple.");
    expect(asked[0].url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect(asked[0].file?.size).toBe(wav().length);
  });

  it("refuses to run without a usable model", async () => {
    await expect(transcribe(readWav(wav())!, undefined, {})).rejects.toThrow("INES_TRANSCRIBE_MODEL is not set.");
  });
});
