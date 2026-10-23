import { describe, expect, it } from "vitest";
import { encodeWav } from "~/lib/utils/wav";

describe("encodeWav", () => {
  it("writes a mono 16-bit PCM WAV at the given rate", () => {
    const bytes = encodeWav(new Float32Array(100), 16_000);
    const view = new DataView(bytes.buffer);
    const text = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));

    expect(bytes.length).toBe(44 + 200);
    expect([text(0), text(8), text(12), text(36)]).toEqual(["RIFF", "WAVE", "fmt ", "data"]);
    expect(view.getUint32(4, true)).toBe(bytes.length - 8);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(28, true)).toBe(32_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(200);
  });

  it("turns samples into 16-bit values, and clips what is out of range", () => {
    const bytes = encodeWav(new Float32Array([0, 1, -1, 0.5, 2, -2]), 16_000);
    const view = new DataView(bytes.buffer);
    const samples = Array.from({ length: 6 }, (_, i) => view.getInt16(44 + i * 2, true));

    expect(samples).toEqual([0, 32767, -32768, 16383, 32767, -32768]);
  });
});
