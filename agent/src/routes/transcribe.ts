import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../auth/middleware.ts";
import { getLogger } from "../lib/logger.ts";
import {
  bodyTooLarge,
  defineRoute,
  errorBody,
  json,
  named,
  tooManyRequests,
  unauthorized,
} from "../lib/openapi.ts";
import { readWav, transcribe, transcribeModel } from "../lib/transcribe.ts";

const logger = getLogger(["app", "transcribe"]);

export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

export const transcribeRoute = defineRoute({
  method: "POST",
  path: "/v1/transcribe",
  tag: "speech",
  summary: "Turns a recording into text.",
  description: "Turns a recording into text, so that a person can ask the agent a question with their voice.",
  request: {
    contentType: "multipart/form-data",
    required: true,
    schema: json("TranscribeRequest", {
      type: "object",
      properties: {
        audio: { type: "string", format: "binary", description: "The recording, a 16-bit PCM WAV file." },
      },
      required: ["audio"],
    }),
  },
  responses: [
    {
      code: "200",
      description: "The text of the recording.",
      schema: named("Transcription", z.object({ text: z.string().describe("The text of the recording.") }), "output"),
    },
    { code: "400", description: "The form has no file, or the file is not a 16-bit PCM WAV file.", schema: errorBody },
    { code: "404", description: "This deployment has no speech to text model.", schema: errorBody },
    unauthorized(),
    bodyTooLarge(),
    tooManyRequests(),
    { code: "502", description: "The speech model failed.", schema: errorBody },
  ],
  secured: true,
});

export const transcribeRouter = new Hono<AppEnv>();

transcribeRouter.post(transcribeRoute.path, async (c) => {
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
