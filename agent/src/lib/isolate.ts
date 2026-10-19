/**
 * Runs work that user input can make slow, big or endless in a process of its own.
 *
 * This process answers every user, and JavaScript, like the SQLite and the document parsers it calls, cannot
 * be interrupted while it runs: one query that never ends, or one crafted file that takes minutes to read,
 * would stop every other request. A worker thread is no help (stopping one does not stop it while it is
 * inside a native call: it goes on using a core for ever), so the work runs in a child process, which is
 * killed when its time is up and which holds no secrets of the agent's (it is given an empty environment).
 *
 * The child reads one JSON input from stdin and writes one JSON result (see isolate-child.ts).
 */

import { getLogger, type Logger } from "@logtape/logtape";
import { RESULT_MARKER } from "./isolate-protocol";
import { metrics } from "./metrics";

const defaultLogger = getLogger(["app", "isolate"]);

export type IsolationFailure = "timeout" | "crash" | "busy" | "output" | "protocol";

export class IsolationError extends Error {
  constructor(
    readonly kind: IsolationFailure,
    message: string,
  ) {
    super(message);
    this.name = "IsolationError";
  }
}

const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
let maxWaiting = 64;

// How many children run at once, and how many wait for their turn: the rest are refused, not queued for ever.
let concurrency = Math.max(1, Number(process.env.INES_ISOLATED_CONCURRENCY) || 4);
let running = 0;
const waiting: Array<() => void> = [];

/** For tests, and for an operator who knows the machine: how many children may run at once, and how many may wait. */
export function setIsolationConcurrency(n: number, queue = 64): void {
  concurrency = Math.max(1, Math.floor(n));
  maxWaiting = Math.max(0, Math.floor(queue));
}

async function takeSlot(): Promise<() => void> {
  const give = () => {
    const next = waiting.shift();
    if (next) next(); // the slot goes straight to the one that waited
    else running--;
  };
  if (running < concurrency) {
    running++;
    return give;
  }
  if (waiting.length >= maxWaiting) {
    metrics.isolated.inc({ kind: "busy" });
    throw new IsolationError("busy", "The server is busy with other work. Try again in a moment.");
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
  return give;
}

export interface RunInChildOptions {
  /** Longest the child may run, from the moment it starts. */
  timeoutMs: number;
  maxOutputBytes?: number;
  /** For logs and metrics: what this work is. */
  label: string;
  /** Where to say that the child died. Default: the agent's. */
  logger?: Logger;
}

async function readCapped(stream: ReadableStream<Uint8Array>, max: number, onTooMuch: () => void): Promise<string> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      onTooMuch();
      break;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Runs `script` (a file that calls `serveOnce`, see isolate-child.ts) with `input` and returns what it
 * answers. Throws IsolationError when it takes too long, dies, or says too much, and Error with the
 * child's own message when the work itself failed.
 */
export async function runInChild<I, O>(script: string, input: I, options: RunInChildOptions): Promise<O> {
  const release = await takeSlot();
  const started = Date.now();
  let outcome: IsolationFailure | "ok" | "failed" = "failed";
  const proc = Bun.spawn([process.execPath, script], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    // Nothing of the agent's environment: not its keys, not its tokens.
    env: { PATH: process.env.PATH ?? "", NODE_ENV: "production", LOG_LEVEL: "error", LOG_FORMAT: "json" },
  });
  let killedFor: "timeout" | "output" | null = null;
  const kill = (why: "timeout" | "output") => {
    killedFor ??= why;
    proc.kill(9);
  };
  const timer = setTimeout(() => kill("timeout"), options.timeoutMs);

  try {
    try {
      proc.stdin.write(JSON.stringify(input));
      await proc.stdin.end();
    } catch {
      // The child ended before reading its input: its exit says why.
    }
    const [stdout, stderr] = await Promise.all([
      readCapped(proc.stdout, options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES, () => kill("output")),
      readCapped(proc.stderr, 64 * 1024, () => {}),
    ]);
    const code = await proc.exited;

    if (killedFor === "timeout") {
      outcome = "timeout";
      throw new IsolationError("timeout", `${options.label} took longer than ${Math.round(options.timeoutMs / 1000)} s and was stopped.`);
    }
    if (killedFor === "output") {
      outcome = "output";
      throw new IsolationError("output", `${options.label} gave more output than is allowed and was stopped.`);
    }
    const at = stdout.lastIndexOf(RESULT_MARKER);
    if (code !== 0 || at === -1) {
      outcome = "crash";
      (options.logger ?? defaultLogger).warn("{label} ended with code {code}: {stderr}", { label: options.label, code, stderr: stderr.slice(0, 500) });
      throw new IsolationError("crash", `${options.label} failed unexpectedly.`);
    }
    let parsed: { ok: boolean; value?: O; error?: string };
    try {
      parsed = JSON.parse(stdout.slice(at + RESULT_MARKER.length));
    } catch {
      outcome = "protocol";
      throw new IsolationError("protocol", `${options.label} gave an answer that could not be read.`);
    }
    if (!parsed.ok) throw new Error(parsed.error ?? `${options.label} failed.`);
    outcome = "ok";
    return parsed.value as O;
  } finally {
    clearTimeout(timer);
    // Whatever happened, nothing is left running.
    proc.kill(9);
    release();
    metrics.isolated.inc({ kind: outcome });
    metrics.isolatedDuration.observe((Date.now() - started) / 1000, { work: options.label.split(" ")[0] });
  }
}
