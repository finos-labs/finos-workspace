import { after as afterAll, before as beforeAll, describe, it } from "node:test";
import { expect } from "expect";
import * as grpc from "@grpc/grpc-js";
import { decodeTranscript, encodeRecognizeRequest, nvidiaFunctionId, recognize } from "../../../../src/lib/riva.ts";

// A minimal protobuf writer and reader for the test's own side of the wire.
const varint = (n: number): number[] => {
  const out: number[] = [];
  while (n > 0x7f) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
  return out;
};
const bytesField = (field: number, bytes: Uint8Array | number[]) => [...varint((field << 3) | 2), ...varint(bytes.length), ...bytes];
const text = (s: string) => [...new TextEncoder().encode(s)];
/** A RecognizeResponse with one result per transcript. */
const response = (...transcripts: string[]) =>
  Buffer.from(transcripts.flatMap((t) => bytesField(1, bytesField(1, bytesField(1, text(t))))));

function readFields(bytes: Uint8Array): Map<number, (number | Uint8Array)[]> {
  const fields = new Map<number, (number | Uint8Array)[]>();
  const readVarint = (at: number): [number, number] => {
    let value = 0;
    let shift = 0;
    for (;;) {
      const b = bytes[at++];
      value |= (b & 0x7f) << shift;
      if (b < 0x80) return [value >>> 0, at];
      shift += 7;
    }
  };
  for (let at = 0; at < bytes.length; ) {
    let tag: number;
    [tag, at] = readVarint(at);
    const list = fields.get(tag >>> 3) ?? [];
    if ((tag & 7) === 0) {
      let v: number;
      [v, at] = readVarint(at);
      list.push(v);
    } else {
      let len: number;
      [len, at] = readVarint(at);
      list.push(bytes.subarray(at, at + len));
      at += len;
    }
    fields.set(tag >>> 3, list);
  }
  return fields;
}

describe("the Riva messages", () => {
  it("asks for 16-bit PCM at the recording's rate, in English, punctuated, with the audio as it is", () => {
    const audio = new Uint8Array([1, 2, 3, 4, 5]);
    const request = readFields(encodeRecognizeRequest(audio, 16_000, 1));
    expect(request.get(2)?.[0]).toEqual(audio);
    const config = readFields(request.get(1)?.[0] as Uint8Array);
    expect(config.get(1)).toEqual([1]); // LINEAR_PCM
    expect(config.get(2)).toEqual([16_000]);
    expect(new TextDecoder().decode(config.get(3)?.[0] as Uint8Array)).toBe("en-US");
    expect(config.get(7)).toEqual([1]); // one channel
    expect(config.get(11)).toEqual([1]); // punctuation
  });

  it("reads the transcript of every result, and nothing from an empty answer", () => {
    expect(decodeTranscript(response("Show me the revenue", "of Apple."))).toBe("Show me the revenue of Apple.");
    expect(decodeTranscript(new Uint8Array())).toBe("");
    expect(() => decodeTranscript(new Uint8Array([0x0a, 0x05, 0x01]))).toThrow("Malformed");
  });
});

describe("the function of a model", () => {
  const list = (functions: { id: string; name: string; status: string }[]) =>
    (async () => Response.json({ functions })) as unknown as typeof fetch;

  it("is the active function NVIDIA lists as ai-<model>", async () => {
    const fetchImpl = list([
      { id: "old", name: "ai-whisper-large-v3", status: "INACTIVE" },
      { id: "fn-1", name: "ai-whisper-large-v3", status: "ACTIVE" },
    ]);
    expect(await nvidiaFunctionId("openai/whisper-large-v3", "key", fetchImpl)).toBe("fn-1");
  });

  it("says when the key can see no such model, and asks again next time", async () => {
    await expect(nvidiaFunctionId("nvidia/no-such-asr", "key", list([]))).rejects.toThrow("no speech model named nvidia/no-such-asr");
    expect(await nvidiaFunctionId("nvidia/no-such-asr", "key", list([{ id: "fn-2", name: "ai-no-such-asr", status: "ACTIVE" }]))).toBe("fn-2");
  });
});

describe("a call to Riva", () => {
  let server: grpc.Server;
  let address = "";
  const seen: { functionId?: string; authorization?: string; audio?: Uint8Array }[] = [];

  beforeAll(async () => {
    server = new grpc.Server();
    server.addService(
      {
        Recognize: {
          path: "/nvidia.riva.asr.RivaSpeechRecognition/Recognize",
          requestStream: false,
          responseStream: false,
          requestSerialize: (b: Buffer) => b,
          requestDeserialize: (b: Buffer) => b,
          responseSerialize: (b: Buffer) => b,
          responseDeserialize: (b: Buffer) => b,
        },
      },
      {
        Recognize: (call: grpc.ServerUnaryCall<Buffer, Buffer>, callback: grpc.sendUnaryData<Buffer>) => {
          seen.push({
            functionId: String(call.metadata.get("function-id")[0]),
            authorization: String(call.metadata.get("authorization")[0]),
            audio: readFields(call.request).get(2)?.[0] as Uint8Array,
          });
          if (seen.at(-1)?.functionId === "refuse") callback({ code: grpc.status.INVALID_ARGUMENT, details: "no" });
          else callback(null, response("Show me the revenue of Apple."));
        },
      },
    );
    const port = await new Promise<number>((resolve, reject) =>
      server.bindAsync("127.0.0.1:0", grpc.ServerCredentials.createInsecure(), (e, p) => (e ? reject(e) : resolve(p))),
    );
    address = `127.0.0.1:${port}`;
  });
  afterAll(() => server.forceShutdown());

  const target = (functionId: string) => ({ address, credentials: grpc.credentials.createInsecure(), functionId });

  it("names the function and carries the key, and returns what was said", async () => {
    const wav = new Uint8Array([9, 8, 7]);
    const text = await recognize({ wav, sampleRateHertz: 16_000, channels: 1, model: "openai/whisper-large-v3", apiKey: "nvapi-key", target: target("fn-1") });
    expect(text).toBe("Show me the revenue of Apple.");
    expect(seen.at(-1)).toEqual({ functionId: "fn-1", authorization: "Bearer nvapi-key", audio: wav });
  });

  it("fails with the gRPC status when Riva refuses the request", async () => {
    await expect(
      recognize({ wav: new Uint8Array([1]), sampleRateHertz: 16_000, channels: 1, model: "m", apiKey: "k", target: target("refuse") }),
    ).rejects.toThrow("NVIDIA speech recognition failed (INVALID_ARGUMENT)");
  });
});
