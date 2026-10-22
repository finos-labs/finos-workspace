/** A 16-bit PCM WAV, optionally with another chunk before its data (as macOS writes them). */
export function wav({ sampleRate = 16_000, channels = 1, bits = 16, format = 1, extraChunk = false, samples = 160 } = {}) {
  const data = new Uint8Array(samples * channels * (bits / 8));
  const extra = extraChunk ? 12 : 0;
  const bytes = new Uint8Array(44 + extra + data.length);
  const view = new DataView(bytes.buffer);
  const put = (at: number, s: string) => [...s].forEach((c, i) => (bytes[at + i] = c.charCodeAt(0)));
  put(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  put(8, "WAVE");
  put(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * (bits / 8), true);
  view.setUint16(32, channels * (bits / 8), true);
  view.setUint16(34, bits, true);
  if (extraChunk) {
    put(36, "FLLR");
    view.setUint32(40, 4, true);
  }
  put(36 + extra, "data");
  view.setUint32(40 + extra, data.length, true);
  return bytes;
}
