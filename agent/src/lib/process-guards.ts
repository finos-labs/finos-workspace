import type { Logger } from "@logtape/logtape";
import { metrics } from "./metrics.ts";

interface ProcessLike {
  on(event: string, listener: (...args: any[]) => void): unknown;
}

export function installErrorGuards(proc: ProcessLike, log: Logger, exit: (code: number) => void = process.exit): void {
  proc.on("unhandledRejection", (reason: unknown) => {
    metrics.unhandled.inc({ kind: "rejection" });
    log.error("A promise failed and nobody was waiting for it: {error}", { error: reason instanceof Error ? (reason.stack ?? reason.message) : String(reason) });
  });
  proc.on("uncaughtException", (error: Error) => {
    metrics.unhandled.inc({ kind: "exception" });
    log.fatal("An exception was not caught: {error}", { error: error.stack ?? error.message });
    setTimeout(() => exit(1), 200).unref?.();
  });
}

interface ShutdownOptions {
  signals?: readonly string[];
  stopAccepting: () => void;
  inFlight: () => number;
  graceMs: number;
  finish: () => Promise<void>;
  exit: (code: number) => void;
  log: Logger;
  pollMs?: number;
}

export function installShutdown(proc: ProcessLike, options: ShutdownOptions): void {
  const { stopAccepting, inFlight, graceMs, finish, exit, log, pollMs = 100 } = options;
  let stopping = false;
  for (const signal of options.signals ?? ["SIGTERM", "SIGINT"]) {
    proc.on(signal, () => {
      if (stopping) {
        log.warn("Asked to stop again: stopping now");
        exit(1);
        return;
      }
      stopping = true;
      void (async () => {
        log.info("Stopping: no new queries, {running} running, up to {seconds} s to finish them", { running: inFlight(), seconds: Math.round(graceMs / 1000) });
        try {
          stopAccepting();
        } catch (error) {
          log.warn("Could not stop taking connections: {error}", { error: String(error) });
        }
        const until = Date.now() + graceMs;
        while (inFlight() > 0 && Date.now() < until) await new Promise((r) => setTimeout(r, pollMs));
        if (inFlight() > 0) log.warn("Stopping with {running} queries still running", { running: inFlight() });
        await finish().catch(() => undefined);
        exit(0);
      })();
    });
  }
}
