/**
 * Speech to text with NVIDIA's hosted models (build.nvidia.com): Riva's `Recognize` over gRPC.
 *
 * NVIDIA serves these models through its cloud functions (NVCF), not the OpenAI-style HTTP API that its
 * chat models use: a call goes to grpc.nvcf.nvidia.com with the function id of the model and the
 * NVIDIA_API_KEY. The model is named the way build.nvidia.com names it (`openai/whisper-large-v3`), and its
 * function id is looked up once from the functions the key can see, where it is listed as
 * `ai-<model>` (`ai-whisper-large-v3`).
 *
 * The request and response are the few fields of Riva's `RecognizeRequest` and `RecognizeResponse` that this
 * uses (nvidia-riva/common, riva_asr.proto), written here by hand in the protobuf wire format.
 */

import * as grpc from "@grpc/grpc-js";

const NVCF_GRPC = "grpc.nvcf.nvidia.com:443";
const NVCF_FUNCTIONS_URL = "https://api.nvcf.nvidia.com/v2/nvcf/functions";
const RECOGNIZE = "/nvidia.riva.asr.RivaSpeechRecognition/Recognize";
const DEADLINE_MS = 60_000;

/** Riva's AudioEncoding (riva_audio.proto): 16-bit PCM, which a WAV file holds. */
const LINEAR_PCM = 1;
/** Riva wants a language for every request. The FINOS Workspace is in English. */
const LANGUAGE = "en-US";

// --- protobuf wire format -----------------------------------------------------------------------------

function varint(value: number): number[] {
  const out: number[] = [];
  let n = value >>> 0;
  while (n > 0x7f) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
  return out;
}

const key = (field: number, wireType: number) => varint((field << 3) | wireType);
const intField = (field: number, value: number) => [...key(field, 0), ...varint(value)];
const bytesField = (field: number, bytes: Uint8Array | number[]) => [...key(field, 2), ...varint(bytes.length), ...bytes];

/** `RecognizeRequest { RecognitionConfig config = 1; bytes audio = 2; }` for 16-bit PCM audio. */
export function encodeRecognizeRequest(audio: Uint8Array, sampleRateHertz: number, channels: number): Buffer {
  const config = [
    ...intField(1, LINEAR_PCM), // encoding
    ...intField(2, sampleRateHertz), // sample_rate_hertz
    ...bytesField(3, new TextEncoder().encode(LANGUAGE)), // language_code
    ...intField(4, 1), // max_alternatives
    ...intField(7, channels), // audio_channel_count
    ...intField(11, 1), // enable_automatic_punctuation
  ];
  const header = [...bytesField(1, config), ...key(2, 2), ...varint(audio.length)];
  return Buffer.concat([Buffer.from(header), audio]);
}

function readVarint(bytes: Uint8Array, start: number): [number, number] {
  let value = 0;
  let shift = 0;
  let i = start;
  for (;;) {
    if (i >= bytes.length || shift > 28) throw new Error("Malformed Riva response.");
    const byte = bytes[i++];
    value |= (byte & 0x7f) << shift;
    if (byte < 0x80) return [value >>> 0, i];
    shift += 7;
  }
}

/** The length-delimited fields of one message, by field number; the rest are skipped. */
function messageFields(bytes: Uint8Array): Array<[number, Uint8Array]> {
  const out: Array<[number, Uint8Array]> = [];
  let i = 0;
  while (i < bytes.length) {
    let tag: number;
    [tag, i] = readVarint(bytes, i);
    const field = tag >>> 3;
    const wireType = tag & 7;
    if (wireType === 0) {
      [, i] = readVarint(bytes, i);
    } else if (wireType === 1) {
      i += 8;
    } else if (wireType === 5) {
      i += 4;
    } else if (wireType === 2) {
      let length: number;
      [length, i] = readVarint(bytes, i);
      if (i + length > bytes.length) throw new Error("Malformed Riva response.");
      out.push([field, bytes.subarray(i, i + length)]);
      i += length;
    } else {
      throw new Error("Malformed Riva response.");
    }
  }
  return out;
}

/**
 * The text of a `RecognizeResponse`: the top alternative's transcript of every result
 * (`results = 1` → `alternatives = 1` → `transcript = 1`), joined.
 */
export function decodeTranscript(response: Uint8Array): string {
  const decoder = new TextDecoder();
  const parts: string[] = [];
  for (const [field, result] of messageFields(response)) {
    if (field !== 1) continue;
    const alternative = messageFields(result).find(([f]) => f === 1)?.[1];
    if (!alternative) continue;
    const transcript = messageFields(alternative).find(([f]) => f === 1)?.[1];
    if (transcript) parts.push(decoder.decode(transcript).trim());
  }
  return parts.filter(Boolean).join(" ");
}

// --- the call -----------------------------------------------------------------------------------------

/** The function id of the model, found once per process: it does not change while Ines runs. */
const functionIds = new Map<string, Promise<string>>();

/** The function id NVIDIA serves `model` under, from the functions the key can see. */
export function nvidiaFunctionId(model: string, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const known = functionIds.get(model);
  if (known) return known;
  const lookup = (async () => {
    const response = await fetchImpl(NVCF_FUNCTIONS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`NVIDIA did not list its functions (HTTP ${response.status}).`);
    const body = (await response.json()) as { functions?: Array<{ id?: string; name?: string; status?: string }> };
    const name = `ai-${model.split("/").pop()}`;
    const fn = body.functions?.find((f) => f.name === name && f.status === "ACTIVE" && f.id);
    if (!fn?.id) throw new Error(`NVIDIA serves no speech model named ${model} for this key.`);
    return fn.id;
  })();
  functionIds.set(model, lookup);
  // A failed lookup is not kept: the next request asks again.
  lookup.catch(() => functionIds.delete(model));
  return lookup;
}

export interface RecognizeOptions {
  /** 16-bit PCM WAV, as the web app records it. */
  wav: Uint8Array;
  sampleRateHertz: number;
  channels: number;
  /** The model as build.nvidia.com names it, e.g. `openai/whisper-large-v3`. */
  model: string;
  apiKey: string;
  signal?: AbortSignal;
  /** Where the call goes: NVIDIA's hosted endpoint, unless a test gives another. */
  target?: { address: string; credentials: grpc.ChannelCredentials; functionId: string };
}

export async function recognize(options: RecognizeOptions): Promise<string> {
  const { wav, sampleRateHertz, channels, model, apiKey, signal, target } = options;
  const functionId = target?.functionId ?? (await nvidiaFunctionId(model, apiKey));
  const client = new grpc.Client(target?.address ?? NVCF_GRPC, target?.credentials ?? grpc.credentials.createSsl());
  const metadata = new grpc.Metadata();
  metadata.set("function-id", functionId);
  metadata.set("authorization", `Bearer ${apiKey}`);

  try {
    return await new Promise<string>((resolve, reject) => {
      const call = client.makeUnaryRequest(
        RECOGNIZE,
        (request: Buffer) => request,
        (response: Buffer) => response,
        encodeRecognizeRequest(wav, sampleRateHertz, channels),
        metadata,
        { deadline: Date.now() + DEADLINE_MS },
        (error, response) => {
          if (error) {
            reject(new Error(`NVIDIA speech recognition failed (${grpc.status[error.code] ?? error.code}).`));
            return;
          }
          try {
            resolve(decodeTranscript(response ?? Buffer.alloc(0)));
          } catch (e) {
            reject(e);
          }
        },
      );
      signal?.addEventListener("abort", () => call.cancel(), { once: true });
    });
  } finally {
    client.close();
  }
}
