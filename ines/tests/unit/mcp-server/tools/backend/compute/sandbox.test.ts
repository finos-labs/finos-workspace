import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";

interface FakeSandbox {
  id: string;
  process: {
    executeCommand: (...args: unknown[]) => Promise<{ exitCode: number; result: string }>;
    codeRun: (...args: unknown[]) => Promise<{ exitCode: number; result: string }>;
  };
  fs: { uploadFile: (buf: Buffer, path: string) => Promise<void> };
}

let createCallCount = 0;
let createParams: Record<string, unknown>[] = [];
let commands: string[] = [];
let nextSandboxFactory: () => FakeSandbox | Promise<FakeSandbox> = () => ({
  id: `sbx-${++createCallCount}`,
  process: {
    executeCommand: async (command: unknown) => {
      commands.push(String(command));
      return { exitCode: 0, result: "" };
    },
    codeRun: async () => ({ exitCode: 0, result: "ines-init:ok" }),
  },
  fs: { uploadFile: async () => {} },
});

mock.module("@daytonaio/sdk", () => ({
  Daytona: class {
    constructor(_opts: unknown) {}
    async create(opts: unknown): Promise<FakeSandbox> {
      createParams.push(opts as Record<string, unknown>);
      return nextSandboxFactory();
    }
  },
}));

const { getSandbox, dropSandbox, _resetSandboxState, sandboxSettings } = await import(
  "../../../../../../mcp-server/src/tools/backend/compute/sandbox"
);

const realKey = process.env.DAYTONA_API_KEY;

const realNetwork = process.env.INES_SANDBOX_NETWORK;
const realSnapshot = process.env.DAYTONA_SNAPSHOT;

beforeEach(() => {
  _resetSandboxState();
  createCallCount = 0;
  createParams = [];
  commands = [];
  delete process.env.INES_SANDBOX_NETWORK;
  delete process.env.DAYTONA_SNAPSHOT;
  nextSandboxFactory = () => ({
    id: `sbx-${++createCallCount}`,
    process: {
      executeCommand: async (command: unknown) => {
        commands.push(String(command));
        return { exitCode: 0, result: "" };
      },
      codeRun: async () => ({ exitCode: 0, result: "ines-init:ok" }),
    },
    fs: { uploadFile: async () => {} },
  });
  process.env.DAYTONA_API_KEY = "test-key";
});

afterEach(() => {
  if (realKey === undefined) delete process.env.DAYTONA_API_KEY;
  else process.env.DAYTONA_API_KEY = realKey;
  if (realNetwork === undefined) delete process.env.INES_SANDBOX_NETWORK;
  else process.env.INES_SANDBOX_NETWORK = realNetwork;
  if (realSnapshot === undefined) delete process.env.DAYTONA_SNAPSHOT;
  else process.env.DAYTONA_SNAPSHOT = realSnapshot;
});

describe("the network of a sandbox", () => {
  it("is open by default, and the packages are installed", async () => {
    await getSandbox("conv-1");
    expect(createParams[0]).not.toHaveProperty("networkBlockAll");
    expect(createParams[0]).not.toHaveProperty("snapshot");
    expect(commands.some((c) => c.startsWith("pip install"))).toBe(true);
  });

  it("is cut off when the deployment says so, from a snapshot that has the packages, which are not installed", async () => {
    process.env.INES_SANDBOX_NETWORK = "blocked";
    process.env.DAYTONA_SNAPSHOT = "ines-python";
    await getSandbox("conv-1");
    expect(createParams[0]).toMatchObject({ snapshot: "ines-python", networkBlockAll: true });
    expect(commands.some((c) => c.startsWith("pip install"))).toBe(false);
  });

  it("starts from a snapshot without cutting the network, and installs nothing", async () => {
    process.env.DAYTONA_SNAPSHOT = "ines-python";
    await getSandbox("conv-1");
    expect(createParams[0]).toMatchObject({ snapshot: "ines-python" });
    expect(createParams[0]).not.toHaveProperty("networkBlockAll");
    expect(commands).toHaveLength(0);
  });

  it("is refused without a snapshot when it is to be cut off, as it could not install the packages, and creates nothing", async () => {
    process.env.INES_SANDBOX_NETWORK = "blocked";
    await expect(getSandbox("conv-1")).rejects.toThrow(/needs DAYTONA_SNAPSHOT/);
    expect(createParams).toHaveLength(0);
  });

  it("is one of two words", () => {
    expect(() => sandboxSettings({ INES_SANDBOX_NETWORK: "closed" })).toThrow(/"open" or "blocked"/);
    expect(sandboxSettings({})).toEqual({ snapshot: undefined, blocked: false });
    expect(sandboxSettings({ INES_SANDBOX_NETWORK: "blocked", DAYTONA_SNAPSHOT: "s" })).toEqual({ snapshot: "s", blocked: true });
  });
});

describe("getSandbox — env guard", () => {
  it("throws when DAYTONA_API_KEY is unset on first creation", async () => {
    delete process.env.DAYTONA_API_KEY;
    await expect(getSandbox("conv-1")).rejects.toThrow(/DAYTONA_API_KEY/);
  });
});

describe("getSandbox — caching", () => {
  it("creates one sandbox per conversation and reuses it", async () => {
    const a = await getSandbox("conv-1");
    const b = await getSandbox("conv-1");
    expect(a).toBe(b);
    expect(createCallCount).toBe(1);
  });

  it("creates separate sandboxes for distinct conversations", async () => {
    const a = await getSandbox("conv-a");
    const b = await getSandbox("conv-b");
    expect(a).not.toBe(b);
    expect(createCallCount).toBe(2);
  });

  it("dropSandbox forces a fresh creation on next call", async () => {
    const first = await getSandbox("conv-1");
    dropSandbox("conv-1");
    const second = await getSandbox("conv-1");
    expect(second).not.toBe(first);
    expect(createCallCount).toBe(2);
  });
});

describe("getSandbox — concurrency", () => {
  it("dedupes parallel calls for the same conversation (inFlight wait)", async () => {
    let resolveCreate!: (v: FakeSandbox) => void;
    const sharedSandbox: FakeSandbox = {
      id: "shared",
      process: {
        executeCommand: async () => ({ exitCode: 0, result: "" }),
        codeRun: async () => ({ exitCode: 0, result: "ines-init:ok" }),
      },
      fs: { uploadFile: async () => {} },
    };
    nextSandboxFactory = () =>
      new Promise<FakeSandbox>((resolve) => {
        resolveCreate = resolve;
      });

    const p1 = getSandbox("conv-race");
    const p2 = getSandbox("conv-race");
    // Allow microtasks to flush so both calls are queued before we resolve.
    await Promise.resolve();
    resolveCreate(sharedSandbox);

    const [a, b] = await Promise.all([p1, p2]);
    expect(a).toBe(b);
    expect(a.id).toBe("shared");
  });
});

describe("getSandbox — init failure cleanup", () => {
  it("does not cache the sandbox when ines init code fails", async () => {
    nextSandboxFactory = () => ({
      id: `sbx-${++createCallCount}`,
      process: {
        executeCommand: async () => ({ exitCode: 0, result: "" }),
        codeRun: async () => ({ exitCode: 1, result: "ines-init:err:boom" }),
      },
      fs: { uploadFile: async () => {} },
    });
    await expect(getSandbox("conv-x")).rejects.toThrow(/ines init failed/);

    nextSandboxFactory = () => ({
      id: `sbx-${++createCallCount}`,
      process: {
        executeCommand: async () => ({ exitCode: 0, result: "" }),
        codeRun: async () => ({ exitCode: 0, result: "ines-init:ok" }),
      },
      fs: { uploadFile: async () => {} },
    });
    const sb = await getSandbox("conv-x");
    expect(sb.id).toMatch(/^sbx-\d+$/);
  });
});
