import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { getLogger, type Logger } from "@logtape/logtape";
import { RESULT_MARKER } from "./isolate-protocol.ts";
import { metrics } from "./metrics.ts";

const defaultLogger = getLogger(["app", "isolate"]);

type IsolationFailure = "timeout" | "crash" | "busy" | "output" | "protocol";

export class IsolationError extends Error {
  readonly kind: IsolationFailure;

  constructor(kind: IsolationFailure, message: string) {
    super(message);
    this.name = "IsolationError";
    this.kind = kind;
  }
}

const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
let maxWaiting = 64;

let concurrency = Math.max(1, Number(process.env.INES_ISOLATED_CONCURRENCY) || 4);
let running = 0;
const waiting: Array<() => void> = [];

export function setIsolationConcurrency(n: number, queue = 64): void {
  concurrency = Math.max(1, Math.floor(n));
  maxWaiting = Math.max(0, Math.floor(queue));
}

async function takeSlot(): Promise<() => void> {
  const give = () => {
    const next = waiting.shift();
    if (next) next();
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

interface RunInChildOptions {
  timeoutMs: number;
  maxOutputBytes?: number;
  label: string;
  logger?: Logger;
}

async function readCapped(stream: Readable, max: number, onTooMuch: () => void): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    size += chunk.byteLength;
    if (size > max) {
      onTooMuch();
      break;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function runInChild<I, O>(script: string, input: I, options: RunInChildOptions): Promise<O> {
  const release = await takeSlot();
  const started = Date.now();
  let outcome: IsolationFailure | "ok" | "failed" = "failed";
  const proc = spawn(process.execPath, [script], {
    stdio: "pipe",
    env: { PATH: process.env.PATH ?? "", NODE_ENV: "production", LOG_LEVEL: "error", LOG_FORMAT: "json" },
  });
  const exited = new Promise<number>((resolve) => {
    proc.once("error", () => resolve(-1));
    proc.once("close", (code) => resolve(code ?? -1));
  });
  let killedFor: "timeout" | "output" | null = null;
  const kill = (why: "timeout" | "output") => {
    killedFor ??= why;
    proc.kill(9);
  };
  const timer = setTimeout(() => kill("timeout"), options.timeoutMs);

  try {
    proc.stdin.on("error", () => {});
    proc.stdin.end(JSON.stringify(input));
    const [stdout, stderr] = await Promise.all([
      readCapped(proc.stdout, options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES, () => kill("output")),
      readCapped(proc.stderr, 64 * 1024, () => {}),
    ]);
    const code = await exited;

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
    proc.kill(9);
    release();
    metrics.isolated.inc({ kind: outcome });
    metrics.isolatedDuration.observe((Date.now() - started) / 1000, { work: options.label.split(" ")[0] });
  }
}
