import { describe, it } from "node:test";
import { expect } from "expect";
import { EventEmitter } from "node:events";
import type { Logger } from "@logtape/logtape";
import { installErrorGuards, installShutdown } from "../../../../src/lib/process-guards.ts";
import { liveDebugIgnored, liveDebugLevel } from "../../../../src/lib/debug-traces.ts";

function fakeLogger() {
  const lines: string[] = [];
  const log = (level: string) => (message: string, props?: Record<string, unknown>) => lines.push(`${level}: ${message} ${JSON.stringify(props ?? {})}`);
  return { lines, log: { error: log("error"), fatal: log("fatal"), warn: log("warn"), info: log("info"), debug: log("debug") } as unknown as Logger };
}
const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("installErrorGuards", () => {
  it("logs a promise nobody waited for and goes on", () => {
    const proc = new EventEmitter();
    const { lines, log } = fakeLogger();
    const exits: number[] = [];
    installErrorGuards(proc, log, (code) => exits.push(code));
    proc.emit("unhandledRejection", new Error("provider blew up"));
    expect(lines.join("\n")).toContain("provider blew up");
    expect(exits).toEqual([]);
  });

  it("logs an exception nobody caught and exits, so that a clean process starts", async () => {
    const proc = new EventEmitter();
    const { lines, log } = fakeLogger();
    const exits: number[] = [];
    installErrorGuards(proc, log, (code) => exits.push(code));
    proc.emit("uncaughtException", new Error("state is in doubt"));
    expect(lines.join("\n")).toContain("state is in doubt");
    await settle(350);
    expect(exits).toEqual([1]);
  });
});

describe("installShutdown", () => {
  function setup(opts: { graceMs: number; running: number[] }) {
    const proc = new EventEmitter();
    const { lines, log } = fakeLogger();
    const events: string[] = [];
    let index = 0;
    installShutdown(proc, {
      stopAccepting: () => events.push("stopAccepting"),
      inFlight: () => opts.running[Math.min(index++, opts.running.length - 1)],
      graceMs: opts.graceMs,
      pollMs: 10,
      finish: async () => void events.push("finish"),
      exit: (code) => events.push(`exit ${code}`),
      log,
    });
    return { proc, events, lines };
  }

  it("takes no new queries, waits for the running ones, flushes, and exits cleanly", async () => {
    const { proc, events } = setup({ graceMs: 2_000, running: [2, 2, 1, 1, 0] });
    proc.emit("SIGTERM");
    await settle(300);
    expect(events).toEqual(["stopAccepting", "finish", "exit 0"]);
  });

  it("does not wait past its grace for a query that does not end", async () => {
    const { proc, events, lines } = setup({ graceMs: 100, running: [1] });
    proc.emit("SIGTERM");
    await settle(400);
    expect(events).toEqual(["stopAccepting", "finish", "exit 0"]);
    expect(lines.join("\n")).toContain("still running");
  });

  it("exits at once when it is asked a second time", async () => {
    const { proc, events } = setup({ graceMs: 5_000, running: [1] });
    proc.emit("SIGTERM");
    proc.emit("SIGINT");
    await settle(30);
    expect(events).toContain("exit 1");
  });
});

describe("liveDebugLevel", () => {
  it("is what was asked for on a developer's machine", () => {
    expect(liveDebugLevel({ LIVE_DEBUG_TRACES: "2" })).toBe(2);
    expect(liveDebugLevel({})).toBe(0);
    expect(liveDebugLevel({ LIVE_DEBUG_TRACES: "nonsense" })).toBe(0);
  });

  it("is nothing in production, where it would write conversations to the log, unless the operator says they mean it", () => {
    expect(liveDebugLevel({ LIVE_DEBUG_TRACES: "2", NODE_ENV: "production" })).toBe(0);
    expect(liveDebugIgnored({ LIVE_DEBUG_TRACES: "2", NODE_ENV: "production" })).toBe(true);
    expect(liveDebugLevel({ LIVE_DEBUG_TRACES: "2", NODE_ENV: "production", INES_ALLOW_DEBUG_TRACES: "true" })).toBe(2);
    expect(liveDebugIgnored({ LIVE_DEBUG_TRACES: "2", NODE_ENV: "production", INES_ALLOW_DEBUG_TRACES: "true" })).toBe(false);
    expect(liveDebugIgnored({ NODE_ENV: "production" })).toBe(false);
  });
});
