/**
 * Speech to text for dictation in the chat (POST /v1/transcribe).
 *
 * The model is INES_TRANSCRIBE_MODEL, written "<provider>:<model>" like DEFAULT_MODEL. Unset, there is no
 * dictation (the web app shows no microphone). The providers that transcribe:
 *
 *   groq    the AI SDK's Groq transcription models, e.g. groq:whisper-large-v3-turbo   (GROQ_API_KEY)
 *   openai  the AI SDK's OpenAI transcription models, e.g. openai:gpt-4o-mini-transcribe (OPENAI_API_KEY)
 *   nvidia  NVIDIA's hosted speech models over Riva gRPC, named as on build.nvidia.com,
 *           e.g. nvidia:openai/whisper-large-v3 (NVIDIA_API_KEY; see riva.ts)
 *
 * The audio is a 16-bit PCM WAV: every one of them takes it, and the web app records it.
 */

import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import { experimental_transcribe as transcribeAudio } from "ai";
import { recognize } from "./riva";

type Env = Record<string, string | undefined>;

const PROVIDERS: Record<string, { keyEnv: string }> = {
  groq: { keyEnv: "GROQ_API_KEY" },
  openai: { keyEnv: "OPENAI_API_KEY" },
  nvidia: { keyEnv: "NVIDIA_API_KEY" },
};

function splitModelId(raw: string): { provider: string; modelId: string } | null {
  const colon = raw.indexOf(":");
  if (colon <= 0 || colon === raw.length - 1) return null;
  return { provider: raw.slice(0, colon), modelId: raw.slice(colon + 1) };
}

/** The model dictation uses, or null when INES_TRANSCRIBE_MODEL is unset. */
export function transcribeModel(env: Env = process.env): string | null {
  return env.INES_TRANSCRIBE_MODEL?.trim() || null;
}

/** What is wrong with INES_TRANSCRIBE_MODEL, or null when it is unset or usable. */
export function transcribeModelProblem(env: Env = process.env): string | null {
  const raw = transcribeModel(env);
  if (!raw) return null;
  const parsed = splitModelId(raw);
  const provider = parsed && PROVIDERS[parsed.provider];
  if (!parsed || !provider) {
    return `INES_TRANSCRIBE_MODEL "${raw}" must be <provider>:<model> with a provider that transcribes (${Object.keys(PROVIDERS).join(", ")}).`;
  }
  if (!env[provider.keyEnv]?.trim()) {
    return `INES_TRANSCRIBE_MODEL names ${parsed.provider}, which needs ${provider.keyEnv}.`;
  }
  return null;
}

export interface WavAudio {
  bytes: Uint8Array;
  sampleRate: number;
  channels: number;
}

/** The format of a 16-bit PCM WAV file, or null when the bytes are not one. */
export function readWav(bytes: Uint8Array): WavAudio | null {
  const text = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.length < 44 || text(0) !== "RIFF" || text(8) !== "WAVE") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let format: { audioFormat: number; channels: number; sampleRate: number; bitsPerSample: number } | null = null;
  let hasData = false;
  for (let at = 12; at + 8 <= bytes.length; ) {
    const id = text(at);
    const size = view.getUint32(at + 4, true);
    if (id === "fmt " && at + 24 <= bytes.length) {
      format = {
        audioFormat: view.getUint16(at + 8, true),
        channels: view.getUint16(at + 10, true),
        sampleRate: view.getUint32(at + 12, true),
        bitsPerSample: view.getUint16(at + 22, true),
      };
    } else if (id === "data") {
      hasData = size > 0;
      break;
    }
    at += 8 + size + (size % 2);
  }
  if (!format || !hasData) return null;
  if (format.audioFormat !== 1 || format.bitsPerSample !== 16) return null;
  if (format.channels < 1 || format.channels > 2 || format.sampleRate < 8_000 || format.sampleRate > 48_000) return null;
  return { bytes, sampleRate: format.sampleRate, channels: format.channels };
}

/** The text of the speech in `audio`, from INES_TRANSCRIBE_MODEL. */
export async function transcribe(audio: WavAudio, signal?: AbortSignal, env: Env = process.env): Promise<string> {
  const raw = transcribeModel(env);
  const problem = raw ? transcribeModelProblem(env) : "INES_TRANSCRIBE_MODEL is not set.";
  if (!raw || problem) throw new Error(problem ?? "INES_TRANSCRIBE_MODEL is not set.");
  const { provider, modelId } = splitModelId(raw)!;
  const apiKey = env[PROVIDERS[provider].keyEnv]!.trim();

  if (provider === "nvidia") {
    return recognize({ wav: audio.bytes, sampleRateHertz: audio.sampleRate, channels: audio.channels, model: modelId, apiKey, signal });
  }
  const model = provider === "groq" ? createGroq({ apiKey }).transcription(modelId) : createOpenAI({ apiKey }).transcription(modelId);
  const { text } = await transcribeAudio({ model, audio: audio.bytes, abortSignal: signal });
  return text.trim();
}
