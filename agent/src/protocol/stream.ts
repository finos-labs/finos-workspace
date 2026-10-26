import type { SSEEvent } from "./types.ts";
import { liveDebugLevel } from "../lib/debug-traces.ts";
import { getLogger } from "../lib/logger.ts";

const logger = getLogger(["app", "sse"]);
const encoder = new TextEncoder();
const LIVE_DEBUG_TRACES_LEVEL = liveDebugLevel();

function traceSseEvent(value: SSEEvent, finalText: { chunks: string[] }): void {
  if (LIVE_DEBUG_TRACES_LEVEL < 1) return;

  if (value.event === "copilotStatusUpdate") {
    const data = value.data as {
      eventType?: string;
      message?: string;
      group?: string;
      details?: unknown;
      artifacts?: unknown;
    };
    const expanded = data.artifacts ?? data.details;
    const suffix = expanded != null
      ? `\n${JSON.stringify(expanded, null, 2)}`
      : "";
    console.error(`[ines:${data.group ?? "status"}:${data.eventType ?? "INFO"}] ${data.message ?? ""}${suffix}`);
    return;
  }

  if (value.event === "copilotFunctionCall") {
    const data = value.data as {
      function?: string;
      input_arguments?: Record<string, unknown>;
    };
    console.error(
      `[ines:tool] ${data.function ?? "unknown"}\n` +
        JSON.stringify(data.input_arguments ?? {}, null, 2),
    );
    return;
  }

  if (value.event === "copilotMessageChunk") {
    const data = value.data as { delta?: unknown };
    if (typeof data.delta === "string") finalText.chunks.push(data.delta);
    return;
  }

  if (value.event === "copilotMessageArtifact") {
    const data = value.data as { type?: string; name?: string; uuid?: string };
    console.error(
      `[ines:artifact] ${data.type ?? "artifact"} ${data.name ?? ""} ${data.uuid ?? ""}`.trim(),
    );
    return;
  }

  if (value.event === "copilotCitationCollection") {
    const data = value.data as { citations?: unknown[] };
    console.error(`[ines:citations] ${data.citations?.length ?? 0}`);
  }
}

function flushTraceFinal(finalText: { chunks: string[] }): void {
  if (LIVE_DEBUG_TRACES_LEVEL < 1 || finalText.chunks.length === 0) return;
  const text = finalText.chunks.join("").trim();
  finalText.chunks = [];
  if (text) console.error(`[ines:final]\n${text}\n[/ines:final]`);
}

/**
 * `onClose` runs once when the stream is over, however it ends: the generator finished, it threw, or the
 * client went away. A generator that was never started does not run its `finally` when it is returned, so
 * what has to be undone for every stream (a user's query slot) cannot be left to one.
 */
export function sseResponse(
  generator: AsyncGenerator<SSEEvent> | (() => AsyncGenerator<SSEEvent>),
  onClose?: () => void,
  /**
   * Runs at once when the client goes away, before the generator is asked to stop: a generator that is in the
   * middle of a model call only stops after it, so what is to cut that call short (an abort signal) goes here.
   */
  onCancel?: () => void,
): Response {
  const gen = typeof generator === "function" ? generator() : generator;

  let closed = false;
  let closeNotified = false;
  const notifyClose = () => {
    if (closeNotified) return;
    closeNotified = true;
    try {
      onClose?.();
    } catch (error) {
      logger.error("The stream's close handler failed", { error });
    }
  };
  const finalText = { chunks: [] as string[] };

  const readable = new ReadableStream({
    async pull(controller) {
      if (closed) return;
      try {
        const { value, done } = await gen.next();
        if (closed) return;
        if (done) {
          closed = true;
          flushTraceFinal(finalText);
          controller.close();
          notifyClose();
          return;
        }
        traceSseEvent(value, finalText);
        const line = `event: ${value.event}\ndata: ${JSON.stringify(value.data)}\n\n`;
        controller.enqueue(encoder.encode(line));
      } catch (e) {
        if (closed) return;
        closed = true;
        logger.error("Stream error", { error: e });
        const errMsg = e instanceof Error ? e.message : String(e);
        const errorEvent: SSEEvent = {
          event: "copilotStatusUpdate",
          data: { eventType: "ERROR", message: errMsg, group: "reasoning" },
        };
        const line = `event: ${errorEvent.event}\ndata: ${JSON.stringify(errorEvent.data)}\n\n`;
        try {
          controller.enqueue(encoder.encode(line));
          controller.close();
        } catch {
          // Controller already closed (client disconnected)
        }
        notifyClose();
      }
    },
    cancel() {
      closed = true;
      flushTraceFinal(finalText);
      try {
        onCancel?.();
      } catch (error) {
        logger.error("The stream's cancel handler failed", { error });
      }
      // Once the generator has finished what it was doing (it may be in the middle of a model call).
      gen.return(undefined).then(notifyClose, notifyClose);
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
