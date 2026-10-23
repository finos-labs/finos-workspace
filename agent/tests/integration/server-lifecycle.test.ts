import { describe, it } from "node:test";
import { expect } from "expect";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const SERVER = join(import.meta.dirname, "../../src/server.ts");
const MCP_SERVER = join(import.meta.dirname, "../../mcp-server/src/server.ts");

function run(script: string, env: Record<string, string>) {
  const proc = spawn(process.execPath, [script], { stdio: ["ignore", "pipe", "pipe"], env });
  let output = "";
  proc.stdout?.on("data", (chunk) => (output += chunk));
  proc.stderr?.on("data", (chunk) => (output += chunk));
  const exited = new Promise<number | null>((resolve) => proc.once("close", (code) => resolve(code)));
  return { proc, exited, output: () => output };
}

async function startServer(extraEnv: Record<string, string> = {}): Promise<{ proc: ChildProcess; exited: Promise<number | null>; base: string }> {
  const port = 20_000 + Math.floor(Math.random() * 20_000);
  const { proc, exited } = run(SERVER, {
    PATH: process.env.PATH ?? "", PORT: String(port), INES_AUTH: "none", INES_CORS_ORIGINS: "*", INES_METRICS_PORT: "0", LOG_LEVEL: "warning", ...extraEnv,
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/status`)).ok) return { proc, exited, base };
    } catch {
    }
    await sleep(100);
  }
  proc.kill(9);
  throw new Error("the server did not start");
}

describe("the server process", () => {
  it("stops with a clean exit when it is sent SIGTERM, and takes no connection after", { timeout: 30_000 }, async () => {
    const { proc, exited, base } = await startServer();
    expect((await fetch(`${base}/status`)).status).toBe(200);
    const started = Date.now();
    proc.kill("SIGTERM");
    const code = await exited;
    expect(code).toBe(0);
    expect(Date.now() - started).toBeLessThan(5_000);
    await expect(fetch(`${base}/status`)).rejects.toThrow();
  });

  it("refuses to start without what it needs, and says what is missing", { timeout: 30_000 }, async () => {
    const port = 20_000 + Math.floor(Math.random() * 20_000);
    const { exited, output } = run(SERVER, { PATH: process.env.PATH ?? "", PORT: String(port), INES_METRICS_PORT: "0" });
    expect(await exited).toBe(1);
    expect(output()).toContain("WORKSPACE_API_URL");
  });
});

describe("the MCP server process", () => {
  it("refuses to fetch the Workspace's files without the Origin the API allows", { timeout: 30_000 }, async () => {
    const { exited, output } = run(MCP_SERVER, {
      PATH: process.env.PATH ?? "",
      INES_AUTH: "none",
      MCP_PORT: String(20_000 + Math.floor(Math.random() * 20_000)),
      MCP_METRICS_PORT: "0",
      WORKSPACE_PUBLIC_URL: "http://localhost:8000",
      WORKSPACE_API_URL: "http://api:8000",
    });
    expect(await exited).toBe(1);
    expect(output()).toContain("WORKSPACE_ORIGIN is required with WORKSPACE_PUBLIC_URL");
  });
});
