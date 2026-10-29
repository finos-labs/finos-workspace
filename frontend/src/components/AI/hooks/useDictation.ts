import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { fetchAgent } from "~/lib/state/agentToken";
import type { Copilot } from "~/lib/state/copilot";
import { encodeWav } from "~/lib/utils/wav";
import { useGetCopilotRequestHeaders } from "./useGetCopilotRequestHeaders";

export const MAX_RECORDING_MS = 120_000;
const SAMPLE_RATE = 16_000;

export type DictationState = "idle" | "recording" | "transcribing";

export function transcribeUrl(agent: Copilot | null | undefined): string | null {
  const query = agent?.endpoints?.query;
  if (!query) return null;
  try {
    return new URL("transcribe", query).toString();
  } catch {
    return null;
  }
}

async function toMono16k(recording: Blob): Promise<Float32Array> {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await recording.arrayBuffer());
    const length = Math.max(1, Math.ceil(decoded.duration * SAMPLE_RATE));
    const offline = new OfflineAudioContext(1, length, SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    return (await offline.startRendering()).getChannelData(0);
  } finally {
    void context.close();
  }
}

export function useDictation(
  agent: Copilot | null | undefined,
  onText: (text: string) => void,
) {
  const [state, setState] = useState<DictationState>("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const discardRef = useRef(false);
  const getCopilotRequestHeaders = useGetCopilotRequestHeaders();

  const send = useCallback(
    async (recording: Blob) => {
      const url = transcribeUrl(agent);
      if (!url) throw new Error("The agent has no address for speech to text.");
      const wav = encodeWav(await toMono16k(recording), SAMPLE_RATE);
      const headers = new Headers(
        getCopilotRequestHeaders(undefined, agent ?? undefined),
      );
      headers.delete("Content-Type");
      const form = new FormData();
      form.set("audio", new Blob([wav], { type: "audio/wav" }), "dictation.wav");
      const response = await fetchAgent(url, { method: "POST", headers, body: form });
      if (!response.ok) throw new Error(`Speech to text failed: ${response.status}`);
      const { text } = (await response.json()) as { text?: string };
      if (text?.trim()) onText(text.trim());
      else toast.info("No speech was heard.");
    },
    [agent, getCopilotRequestHeaders, onText],
  );

  const stop = useCallback(() => {
    clearTimeout(stopTimerRef.current);
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }, []);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error("Voice input needs the page to be served over HTTPS.");
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      toast.error("This browser cannot record audio.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      toast.error(
        error instanceof DOMException && error.name === "NotFoundError"
          ? "No microphone was found."
          : "Allow the microphone in your browser to use voice input.",
      );
      return;
    }

    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;
    discardRef.current = false;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = async () => {
      for (const track of stream.getTracks()) track.stop();
      recorderRef.current = null;
      if (discardRef.current || chunks.length === 0) {
        setState("idle");
        return;
      }
      setState("transcribing");
      try {
        await send(new Blob(chunks, { type: recorder.mimeType }));
      } catch {
        toast.error("Speech to text failed. Try again.");
      } finally {
        setState("idle");
      }
    };
    recorder.start();
    setState("recording");
    stopTimerRef.current = setTimeout(stop, MAX_RECORDING_MS);
  }, [send, stop]);

  useEffect(
    () => () => {
      clearTimeout(stopTimerRef.current);
      discardRef.current = true;
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    },
    [],
  );

  return { state, start, stop };
}
