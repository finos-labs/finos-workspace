import { describe, it, afterEach } from "node:test";
import { expect } from "expect";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IsolationError, runInChild, setIsolationConcurrency } from "../../../../src/lib/isolate.ts";

const script = (name: string) => join(import.meta.dirname, "../../../fixtures/isolate", `${name}.ts`);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = <O = any>(name: string, input: unknown, timeoutMs = 10_000, extra: { maxOutputBytes?: number } = {}) =>
  runInChild<unknown, O>(script(name), input, { timeoutMs, label: `test ${name}`, ...extra });
const failure = (error: unknown) => error as IsolationError;

afterEach(() => setIsolationConcurrency(4));

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const pidFile = () => join(mkdtempSync(join(tmpdir(), "isolate-")), "pid");
const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("runInChild", () => {
  it("runs the work in another process and returns its answer", async () => {
    expect(await run<unknown>("echo", { a: [1, 2, { b: "c" }] })).toEqual({ got: { a: [1, 2, { b: "c" }] } });
  });

  it("carries a large input", async () => {
    const big = { rows: Array.from({ length: 50_000 }, (_, i) => ({ i, text: "x".repeat(50) })) };
    const out = await run<{ got: typeof big }>("echo", big);
    expect(out.got.rows).toHaveLength(50_000);
  });

  it("gives the message of work that failed, as an error that is not an isolation failure", async () => {
    const error = (await run("fail", {}).catch((e) => e)) as Error;
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(IsolationError);
    expect(error.message).toBe("the work failed");
  });

  it("is not fooled by what the work prints besides its answer", async () => {
    expect(await run<unknown>("noise", {})).toBe("the answer");
  });

  it("gives the work no secret of this process", async () => {
    process.env.SECRET_FOR_ISOLATION_TEST = "do-not-leak";
    try {
      const names = await run<string[]>("env", {});
      expect(names).not.toContain("SECRET_FOR_ISOLATION_TEST");
      expect(names.filter((n) => /KEY|TOKEN|SECRET|PASSWORD/i.test(n))).toEqual([]);
    } finally {
      delete process.env.SECRET_FOR_ISOLATION_TEST;
    }
  });

  it("stops work that never ends, and nothing of it is left running", async () => {
    const file = pidFile();
    const started = Date.now();
    const error = failure(await run("spin-js", { pidFile: file }, 800).catch((e) => e));
    expect(error).toBeInstanceOf(IsolationError);
    expect(error.kind).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(4_000);
    const pid = Number(readFileSync(file, "utf8"));
    await settle(200);
    expect(alive(pid)).toBe(false);
  });

  it("stops work that is stuck inside a native call (a SQL query that never ends)", async () => {
    const file = pidFile();
    const error = await run("spin-sqlite", { pidFile: file }, 800).catch((e) => e);
    expect((error as IsolationError).kind).toBe("timeout");
    const pid = Number(readFileSync(file, "utf8"));
    await settle(200);
    expect(alive(pid)).toBe(false);
  });

  it("keeps this process answering while the work runs", async () => {
    let beats = 0;
    const timer = setInterval(() => beats++, 50);
    await run("spin-js", { pidFile: pidFile() }, 1_000).catch(() => undefined);
    clearInterval(timer);
    // A blocked process would have beaten a handful of times at most.
    expect(beats).toBeGreaterThan(10);
  });

  it("stops work that says too much", async () => {
    const error = await run("big-output", { bytes: 5_000_000 }, 10_000, { maxOutputBytes: 1_000_000 }).catch((e) => e);
    expect((error as IsolationError).kind).toBe("output");
  });

  it("reports work that dies", async () => {
    const error = (await run("crash", {}).catch((e) => e)) as Error;
    expect((error as IsolationError).kind).toBe("crash");
    // ...without passing on what the child wrote to its stderr.
    expect(String(error.message)).not.toContain("about to die");
  });

  it("runs only as many at once as it is allowed, and the rest wait their turn", async () => {
    setIsolationConcurrency(1);
    const [a, b, c] = await Promise.all([run<{ start: number; end: number }>("sleep", { ms: 250 }), run<{ start: number; end: number }>("sleep", { ms: 250 }), run<{ start: number; end: number }>("sleep", { ms: 250 })]);
    const runs = [a, b, c].sort((x, y) => x.start - y.start);
    expect(runs[1].start).toBeGreaterThanOrEqual(runs[0].end);
    expect(runs[2].start).toBeGreaterThanOrEqual(runs[1].end);
  });

  it("refuses work when too much is already waiting", async () => {
    setIsolationConcurrency(1, 2);
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => run("sleep", { ms: 150 })));
    const refused = results.filter((r) => r.status === "rejected" && (r.reason as IsolationError).kind === "busy");
    expect(refused.length).toBe(3);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
  });

  it("frees its place when the work ends badly, so that later work is not held up", async () => {
    setIsolationConcurrency(1);
    await run("spin-js", { pidFile: pidFile() }, 300).catch(() => undefined);
    await run("fail", {}).catch(() => undefined);
    expect(await run<unknown>("echo", { ok: 1 })).toEqual({ got: { ok: 1 } });
  });
});
