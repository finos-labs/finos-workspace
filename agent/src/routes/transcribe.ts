import { Hono } from "hono";
import type { AppEnv } from "../auth/middleware.ts";
import { getLogger } from "../lib/logger.ts";
import { readWav, transcribe, transcribeModel } from "../lib/transcribe.ts";

const logger = getLogger(["app", "transcribe"]);

export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

export const transcribeRouter = new Hono<AppEnv>();

transcribeRouter.post("/v1/transcribe", async (c) => {
  if (!transcribeModel()) return c.json({ error: "Speech to text is not set up for this agent." }, 404);

  const form = await c.req.formData().catch(() => null);
  const file = form?.get("audio");
  if (!(file instanceof File)) return c.json({ error: "Missing 'audio' file in form data." }, 400);
  if (file.size > MAX_AUDIO_BYTES) return c.json({ error: "The recording is too long." }, 413);

  const audio = readWav(new Uint8Array(await file.arrayBuffer()));
  if (!audio) return c.json({ error: "The audio must be a 16-bit PCM WAV file." }, 400);

  const started = performance.now();
  try {
    const text = await transcribe(audio, c.req.raw.signal);
    logger.info("Transcribed a recording", {
      bytes: audio.bytes.length,
      ms: Math.round(performance.now() - started),
      empty: text.length === 0,
    });
    return c.json({ text });
  } catch (error) {
    logger.warn("Transcription failed", { error: error instanceof Error ? error.message : String(error) });
    return c.json({ error: "Speech to text failed. Try again." }, 502);
  }
});
