/**
 * Tier 2 — the real server process: it starts, answers, and stops politely when it is told to.
 */

import { describe, it, expect } from "bun:test";
import { join } from "node:path";

const SERVER = join(import.meta.dir, "../../src/server.ts");

async function startServer(extraEnv: Record<string, string> = {}) {
  const port = 20_000 + Math.floor(Math.random() * 20_000);
  const proc = Bun.spawn([process.execPath, SERVER], {
    stdout: "pipe",
    stderr: "pipe",
    env: { PATH: process.env.PATH ?? "", PORT: String(port), INES_AUTH: "none", INES_CORS_ORIGINS: "*", INES_METRICS_PORT: "0", LOG_LEVEL: "warning", ...extraEnv },
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/status`)).ok) return { proc, base };
    } catch {
      /* not up yet */
    }
    await Bun.sleep(100);
  }
  proc.kill(9);
  throw new Error("the server did not start");
}

describe("the server process", () => {
  it("stops with a clean exit when it is sent SIGTERM, and takes no connection after", async () => {
    const { proc, base } = await startServer();
    expect((await fetch(`${base}/status`)).status).toBe(200);
    const started = Date.now();
    proc.kill("SIGTERM");
    const code = await proc.exited;
    expect(code).toBe(0);
    expect(Date.now() - started).toBeLessThan(5_000);
    await expect(fetch(`${base}/status`)).rejects.toThrow();
  }, 30_000);

  it("refuses to start without what it needs, and says what is missing", async () => {
    const port = 20_000 + Math.floor(Math.random() * 20_000);
    const proc = Bun.spawn([process.execPath, SERVER], {
      stdout: "pipe",
      stderr: "pipe",
      env: { PATH: process.env.PATH ?? "", PORT: String(port), INES_METRICS_PORT: "0" },
    });
    const code = await proc.exited;
    expect(code).toBe(1);
    const output = (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text());
    expect(output).toContain("WORKSPACE_API_URL");
  }, 30_000);
});
