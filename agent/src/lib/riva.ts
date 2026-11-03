import * as grpc from "@grpc/grpc-js";

const NVCF_GRPC = "grpc.nvcf.nvidia.com:443";
const NVCF_FUNCTIONS_URL = "https://api.nvcf.nvidia.com/v2/nvcf/functions";
const RECOGNIZE = "/nvidia.riva.asr.RivaSpeechRecognition/Recognize";
const DEADLINE_MS = 60_000;

const LINEAR_PCM = 1;
const LANGUAGE = "en-US";


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

export function encodeRecognizeRequest(audio: Uint8Array, sampleRateHertz: number, channels: number): Buffer {
  const config = [
    ...intField(1, LINEAR_PCM),
    ...intField(2, sampleRateHertz),
    ...bytesField(3, new TextEncoder().encode(LANGUAGE)),
    ...intField(4, 1),
    ...intField(7, channels),
    ...intField(11, 1),
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


const functionIds = new Map<string, Promise<string>>();

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
  lookup.catch(() => functionIds.delete(model));
  return lookup;
}

interface RecognizeOptions {
  wav: Uint8Array;
  sampleRateHertz: number;
  channels: number;
  model: string;
  apiKey: string;
  signal?: AbortSignal;
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
