import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import shellSource from "~/plugins/shell/shell.js?raw";

/**
 * The conformance suite of the guest contract (docs/widget-plugins/GUEST-CONTRACT.md 8),
 * on the shell itself: `shell.js` runs as the frame runs it, with this test as the host
 * on the other end of its port. What only a real frame can show (the sandbox, the policy,
 * the host's checks of what arrives) is in the Playwright specs.
 *
 * The plugin modules are written here and record what they see on
 * `globalThis.conformance`. The shell's one `import(url)` of the bundle's Blob URL becomes
 * an import of a `data:` URL made from the same text: Vitest's module runner does not let
 * code built with `new Function` call `import()` itself. The frame's own import runs in
 * the Playwright specs.
 */

type Posted = { t: string; [key: string]: unknown };

declare global {
  // biome-ignore lint/suspicious/noExplicitAny: what the test modules record
  var conformance: Record<string, any>;
}

/** Stands in for the frame's Blob: the shell builds one from the entry's text. */
class EntryBlob {
  constructor(readonly parts: string[]) {}
}

/** Stands in for the frame's URL: an object URL is a `data:` URL of the entry's text. */
const EntryURL = Object.assign(class extends URL {}, {
  createObjectURL: (blob: unknown) =>
    `data:text/javascript;base64,${Buffer.from((blob as EntryBlob).parts.join("")).toString("base64")}`,
  revokeObjectURL: () => undefined,
});

const BUNDLE_IMPORT = "await import(url)";
const shellBody = (() => {
  expect(shellSource.split(BUNDLE_IMPORT)).toHaveLength(2);
  return shellSource.replace(BUNDLE_IMPORT, "await importBundle(url)");
})();
const importBundle = (url: string) => import(/* @vite-ignore */ url);

function until(check: () => boolean, ms = 2000) {
  return vi.waitFor(() => expect(check()).toBe(true), { timeout: ms, interval: 5 });
}

/** Stands in for the browser's Worker: records how it was started and what it was sent. */
class FakeWorker extends EventTarget {
  static started: FakeWorker[] = [];
  posted: { message: unknown; transfer: unknown[] }[] = [];
  terminated = false;
  constructor(
    readonly url: string,
    readonly options?: { type?: string },
  ) {
    super();
    FakeWorker.started.push(this);
  }
  postMessage(message: unknown, transfer: unknown[] = []) {
    this.posted.push({ message, transfer });
  }
  terminate() {
    this.terminated = true;
  }
}

/** Object URLs of the frame's own scope, for the workers it starts. */
function workerScope() {
  const texts = new Map<string, string>();
  const revoked: string[] = [];
  let next = 0;
  const URLs = {
    createObjectURL(blob: EntryBlob) {
      next += 1;
      const url = `blob:null/${next}`;
      texts.set(url, blob.parts.join(""));
      return url;
    },
    revokeObjectURL(url: string) {
      revoked.push(url);
    },
  };
  return {
    texts,
    revoked,
    globals: {
      Worker: FakeWorker,
      URL: URLs,
      Blob: EntryBlob,
      MessageChannel,
      atob,
      TextDecoder,
    },
  };
}

/** One frame: the shell running against a fake window, and the port the host holds. */
async function startShell(globals: Record<string, unknown> = {}) {
  const root = document.createElement("div");
  root.id = "root";
  document.body.replaceChildren(root);
  document.documentElement.setAttribute("data-ws", JSON.stringify({ probes: [] }));

  const listeners = new Map<string, (event: unknown) => void>();
  const parent = { postMessage: vi.fn() };
  const fakeWindow: Record<string, unknown> = {
    ...globals,
    parent,
    addEventListener: (type: string, listener: (event: unknown) => void) =>
      listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
  };
  const sent: Posted[] = [];
  const port = {
    onmessage: null as ((event: { data: unknown }) => void) | null,
    closed: false,
    postMessage: (message: Posted) => sent.push(message),
    close() {
      this.closed = true;
    },
  };

  new Function("window", "self", "URL", "Blob", "indexedDB", "importBundle", shellBody)(
    fakeWindow,
    { origin: "null" },
    EntryURL,
    EntryBlob,
    undefined,
    importBundle,
  );
  expect(parent.postMessage).toHaveBeenCalledWith({ type: "ws-shell-ready" }, "*");
  // The port arrives from the parent only
  listeners.get("message")?.({
    source: parent,
    data: { type: "ws-shell-port" },
    ports: [port],
  });
  await until(() => sent.some((m) => m.t === "hello"));

  const deliver = (message: Record<string, unknown>) =>
    port.onmessage?.({ data: message });
  const posted = (t: string) => sent.filter((m) => m.t === t);

  return {
    root,
    port,
    sent,
    posted,
    deliver,
    window: fakeWindow,
    /** Sends the bundle and waits until it loaded or failed. */
    async load(entry: string, options: { state?: object; writable?: string[] } = {}) {
      deliver({
        t: "load",
        entry,
        styles: [],
        state: options.state ?? {},
        writable: options.writable ?? [],
        timeouts: { initialize: 1000, render: 1000 },
      });
      await until(() => sent.some((m) => m.t === "loaded" || m.t === "error"));
    },
  };
}

beforeEach(() => {
  globalThis.conformance = { order: [] };
});

afterEach(() => {
  document.body.replaceChildren();
});

describe("the guest contract, spec cases", () => {
  it("awaits initialize before render, with every bound trait present", async () => {
    const shell = await startShell();
    await shell.load(
      `export default {
        async initialize({ model }) {
          conformance.order.push("initialize:" + model.get("data").rows);
          await new Promise((resolve) => setTimeout(resolve, 20));
          conformance.order.push("initialized");
        },
        render() { conformance.order.push("render"); },
      };`,
      { state: { data: { rows: 3 } } },
    );
    expect(conformance.order).toEqual(["initialize:3", "initialized", "render"]);
    expect(shell.posted("loaded")).toHaveLength(1);
  });

  it("takes a factory as the default export", async () => {
    const shell = await startShell();
    await shell.load(
      `export default async () => ({ render() { conformance.order.push("render"); } });`,
    );
    expect(conformance.order).toEqual(["render"]);
  });

  it.each([
    "initialize",
    "render",
  ])("stops when %s fails: the next phase does not run, the signal aborts, the error is reported", async (phase) => {
    const shell = await startShell();
    await shell.load(
      `export default {
          initialize({ signal }) {
            signal.addEventListener("abort", () => conformance.order.push("aborted"));
            if (${JSON.stringify(phase)} === "initialize") throw new Error("it failed");
          },
          render() {
            conformance.order.push("render");
            throw new Error("it failed");
          },
        };`,
    );
    expect(shell.posted("error")).toEqual([
      { t: "error", phase, message: "it failed" },
    ]);
    expect(shell.posted("loaded")).toEqual([]);
    expect(conformance.order).toEqual(
      phase === "initialize" ? ["aborted"] : ["render", "aborted"],
    );
  });

  it("aborts the signal on dispose, runs each cleanup once, empties el and closes the port", async () => {
    const shell = await startShell();
    await shell.load(
      `export default {
        render({ el, signal }) {
          el.textContent = "drawn";
          signal.addEventListener("abort", () => conformance.order.push("aborted"));
          return () => conformance.order.push("cleanup");
        },
      };`,
    );
    expect(shell.root.textContent).toBe("drawn");
    shell.deliver({ t: "dispose" });
    shell.deliver({ t: "dispose" });
    expect(conformance.order).toEqual(["aborted", "cleanup"]);
    expect(shell.root.textContent).toBe("");
    expect(shell.posted("disposed")).toHaveLength(1);
    expect(shell.port.closed).toBe(true);
  });

  it("fires change: after a host push, for the traits that changed, and after a local set", async () => {
    const shell = await startShell();
    await shell.load(
      `export default {
        render({ model }) {
          for (const name of ["a", "b", "local"])
            model.on("change:" + name, (...args) =>
              conformance.order.push(name + "=" + JSON.stringify(model.get(name)) + "/" + args.length));
          conformance.model = model;
        },
      };`,
      { state: { a: 1, b: 2 } },
    );
    shell.deliver({ t: "push", traits: { a: 10, b: 2 } });
    conformance.model.set("local", "x");
    // Callbacks get no arguments; they read with get
    expect(conformance.order).toEqual(["a=10/0", 'local="x"/0']);
  });

  it("removes a listener, the listeners of an event, or all of them with off", async () => {
    const shell = await startShell();
    await shell.load(
      `export default {
        render({ model }) {
          const one = () => conformance.order.push("one");
          const two = () => conformance.order.push("two");
          model.on("change:a", one);
          model.on("change:a", two);
          model.on("change:b", () => conformance.order.push("b"));
          conformance.off = {
            one: () => model.off("change:a", one),
            event: () => model.off("change:a"),
            all: () => model.off(),
          };
        },
      };`,
      { state: { a: 0, b: 0 } },
    );
    conformance.off.one();
    shell.deliver({ t: "push", traits: { a: 1, b: 1 } });
    conformance.off.event();
    shell.deliver({ t: "push", traits: { a: 2, b: 2 } });
    conformance.off.all();
    shell.deliver({ t: "push", traits: { a: 3, b: 3 } });
    expect(conformance.order).toEqual(["two", "b", "b"]);
  });

  it("returns copies from get", async () => {
    const shell = await startShell();
    await shell.load(
      `export default {
        render({ model }) {
          const value = model.get("data");
          value.rows.push("changed");
          conformance.order.push(model.get("data").rows.length);
        },
      };`,
      { state: { data: { rows: [1] } } },
    );
    expect(conformance.order).toEqual([1]);
  });

  it("sends the changed bound traits on save_changes, and an echo restores a refused write", async () => {
    const shell = await startShell();
    await shell.load(
      `export default {
        render({ model }) {
          model.on("change:params", () => conformance.order.push(model.get("params").region));
          conformance.model = model;
        },
      };`,
      { state: { params: { region: "emea" } }, writable: ["params"] },
    );
    conformance.model.set("params", { region: "apac" });
    conformance.model.set("frameLocal", true);
    conformance.model.save_changes();
    // A trait with no binding stays in the frame
    expect(shell.posted("write")).toEqual([
      { t: "write", traits: { params: { region: "apac" } } },
    ]);
    shell.deliver({ t: "echo", traits: { params: { region: "emea" } } });
    expect(conformance.model.get("params")).toEqual({ region: "emea" });
    expect(conformance.order).toEqual(["apac", "emea"]);
  });

  it("delivers host events as msg:custom, with buffers as DataViews", async () => {
    const shell = await startShell();
    await shell.load(
      `export default {
        render({ model }) {
          model.on("msg:custom", (content, buffers) =>
            conformance.order.push([content.name, buffers.map((b) => b instanceof DataView && b.getUint8(0))]));
        },
      };`,
    );
    shell.deliver({
      t: "event",
      content: { kind: "workspace-event", name: "refresh" },
      buffers: [new Uint8Array([7]).buffer],
    });
    expect(conformance.order).toEqual([["refresh", [7]]]);
  });

  describe("invoke", () => {
    const entry = `export default {
      render({ experimental }) { conformance.invoke = experimental.invoke; },
    };`;

    it("resolves to [value, buffers] when the host answers", async () => {
      const shell = await startShell();
      await shell.load(entry);
      const call = conformance.invoke(
        "core:ui:notify",
        { text: "hi" },
        {
          buffers: [new Uint8Array([1, 2])],
        },
      );
      const [message] = shell.posted("invoke");
      expect(message).toMatchObject({ name: "core:ui:notify", msg: { text: "hi" } });
      expect(new Uint8Array((message.buffers as ArrayBuffer[])[0])).toEqual(
        new Uint8Array([1, 2]),
      );
      shell.deliver({
        t: "result",
        id: message.id,
        ok: true,
        value: { done: true },
        buffers: [new Uint8Array([9]).buffer],
      });
      const [value, views] = await call;
      expect(value).toEqual({ done: true });
      expect(views[0].getUint8(0)).toBe(9);
    });

    it("rejects with the name of the host's refusal", async () => {
      const shell = await startShell();
      await shell.load(entry);
      const call = conformance.invoke("core:clipboard:write", {});
      const [message] = shell.posted("invoke");
      shell.deliver({
        t: "result",
        id: message.id,
        ok: false,
        error: { name: "not_granted", message: "no" },
      });
      await expect(call).rejects.toMatchObject({ name: "not_granted" });
    });

    it("times out", async () => {
      const shell = await startShell();
      await shell.load(entry);
      await expect(
        conformance.invoke("core:ui:notify", {}, { timeout: 20 }),
      ).rejects.toMatchObject({ name: "timeout" });
    });

    it("honors an abort, before and during the call", async () => {
      const shell = await startShell();
      await shell.load(entry);
      await expect(
        conformance.invoke("core:ui:notify", {}, { signal: AbortSignal.abort() }),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(shell.posted("invoke")).toEqual([]);
      const controller = new AbortController();
      const call = conformance.invoke(
        "core:ui:notify",
        {},
        { signal: controller.signal },
      );
      controller.abort();
      await expect(call).rejects.toMatchObject({ name: "AbortError" });
    });

    it("answers anywidget's own invoke, sent with model.send, as msg:custom", async () => {
      const shell = await startShell();
      await shell.load(`export default {
        render({ model }) {
          // What anywidget's invoke does: send a command, wait for the reply with its id
          model.on("msg:custom", (content, buffers) => {
            if (content.id === "call-1") conformance.reply = [content, buffers.length];
          });
          model.send({ id: "call-1", kind: "anywidget-command", name: "core:ui:notify", msg: { text: "hi" } }, undefined, []);
          model.send({ something: "else" });
        },
      };`);
      const [message] = shell.posted("invoke");
      expect(message).toMatchObject({ name: "core:ui:notify", msg: { text: "hi" } });
      shell.deliver({
        t: "result",
        id: message.id,
        ok: true,
        value: "shown",
        buffers: [],
      });
      await until(() => !!conformance.reply);
      expect(conformance.reply).toEqual([
        { id: "call-1", kind: "anywidget-command-response", response: "shown" },
        0,
      ]);
      // Anything else sent is dropped, and counted as a log line
      expect(shell.posted("invoke")).toHaveLength(1);
      expect(shell.posted("log").map((m) => m.text)).toContain(
        "model.send carries only anywidget commands; the message was dropped",
      );
    });
  });
});

describe("the guest contract, negative cases", () => {
  it("rejects cross-widget access with not_available", async () => {
    const shell = await startShell();
    await shell.load(`export default {
      async render({ model, host }) {
        for (const attempt of [() => host.getWidget("x"), () => host.getModel("x"), () => model.widget_manager.get_model("x")])
          conformance.order.push(await attempt().then(() => "allowed", (e) => e.name));
      },
    };`);
    expect(conformance.order).toEqual([
      "not_available",
      "not_available",
      "not_available",
    ]);
  });

  it("drops what the host did not send: unknown messages and a second port", async () => {
    const shell = await startShell();
    await shell.load("export default { render() {} };");
    const before = shell.sent.length;
    shell.deliver({ t: "unknown" });
    shell.deliver({ t: "result", id: 999, ok: true });
    expect(shell.sent.length).toBe(before);
  });

  it("reports only the violations the browser raised", async () => {
    const shell = await startShell();
    await shell.load("export default { render() {} };");
    const forged = Object.assign(new Event("securitypolicyviolation"), {
      blockedURI: "https://forged.example.org/x",
      effectiveDirective: "connect-src",
    });
    document.dispatchEvent(forged);
    expect(shell.posted("csp")).toEqual([]);
  });

  it("refuses buffers that are not binary before anything is sent", async () => {
    const shell = await startShell();
    await shell.load(`export default {
      render({ experimental }) { conformance.invoke = experimental.invoke; },
    };`);
    await expect(
      conformance.invoke("core:download:save", {}, { buffers: ["text"] }),
    ).rejects.toMatchObject({ name: "invalid_args" });
    expect(shell.posted("invoke")).toEqual([]);
  });
});

describe("workers the plugin starts", () => {
  type WorkerClass = new (url: string, options?: { type?: string }) => FakeWorker;

  async function frame() {
    FakeWorker.started = [];
    const scope = workerScope();
    const shell = await startShell(scope.globals);
    const Worker = shell.window.Worker as WorkerClass;
    const URLs = shell.window.URL as typeof scope.globals.URL;
    return { ...scope, shell, Worker, URLs };
  }

  /** The port the shell handed the worker, and what arrives on it as the worker. */
  function handedPort(worker: FakeWorker) {
    const [first] = worker.posted;
    expect(first.message).toEqual({ type: "ws-worker-port" });
    return first.transfer[0] as MessagePort;
  }

  it("starts a blob: worker with the reporter, and its port comes before the plugin's messages", async () => {
    const { Worker, URLs, texts } = await frame();
    const own = URLs.createObjectURL(new EntryBlob(["self.onmessage = () => {};"]));
    const worker = new Worker(own);
    worker.postMessage("go");

    expect(worker).toBeInstanceOf(FakeWorker);
    const started = FakeWorker.started[0];
    const text = texts.get(started.url) ?? "";
    expect(text).toContain("(function reportWorkers(scope, source, deliver)");
    expect(text.endsWith(`importScripts(${JSON.stringify(own)});`)).toBe(true);
    expect(started.posted.map((p) => p.message)).toEqual([
      { type: "ws-worker-port" },
      "go",
    ]);
    handedPort(started).close();
  });

  it("holds the revocation of the worker's URL until the worker started", async () => {
    const { Worker, URLs, revoked } = await frame();
    const own = URLs.createObjectURL(new EntryBlob(["x"]));
    new Worker(own);
    URLs.revokeObjectURL(own);
    expect(revoked).not.toContain(own);

    const port = handedPort(FakeWorker.started[0]);
    port.postMessage({ t: "started" });
    await until(() => revoked.includes(own));
    // Its own script goes with it
    expect(revoked).toContain(FakeWorker.started[0].url);
    // An URL no worker is loading is revoked at once
    const other = URLs.createObjectURL(new EntryBlob(["y"]));
    URLs.revokeObjectURL(other);
    expect(revoked).toContain(other);
    port.close();
  });

  it("releases a held revocation when the worker fails or is terminated", async () => {
    const { Worker, URLs, revoked } = await frame();
    const failing = URLs.createObjectURL(new EntryBlob(["x"]));
    new Worker(failing);
    URLs.revokeObjectURL(failing);
    FakeWorker.started[0].dispatchEvent(new Event("error"));
    expect(revoked).toContain(failing);

    const ended = URLs.createObjectURL(new EntryBlob(["y"]));
    const worker = new Worker(ended);
    URLs.revokeObjectURL(ended);
    worker.terminate();
    expect(revoked).toContain(ended);
    expect(FakeWorker.started[1].terminated).toBe(true);
  });

  it("hands the host what a worker's policy blocked, as the document's reports", async () => {
    const { Worker, URLs, shell } = await frame();
    await shell.load("export default { render() {} };");
    new Worker(URLs.createObjectURL(new EntryBlob(["x"])));
    const port = handedPort(FakeWorker.started[0]);
    port.postMessage({ t: "started" });
    port.postMessage({
      t: "csp",
      directive: "connect-src",
      blocked: "https://worker.example.org/beacon",
    });
    port.postMessage({
      t: "csp",
      directive: "connect-src",
      blocked: "https://worker.example.org/again",
    });
    await until(() => shell.posted("csp").length > 0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(shell.posted("csp")).toEqual([
      { t: "csp", directive: "connect-src", origin: "https://worker.example.org" },
    ]);
    port.close();
  });

  it("starts a module worker with the reporter imported first", async () => {
    const { Worker, URLs, texts } = await frame();
    const own = URLs.createObjectURL(new EntryBlob(["export {};"]));
    new Worker(own, { type: "module" });
    const started = FakeWorker.started[0];
    expect(started.options).toEqual({ type: "module" });
    const [reporter, rest] = (texts.get(started.url) ?? "").split("\n");
    expect(rest).toBe(`import ${JSON.stringify(own)};`);
    const reporterUrl = JSON.parse(reporter.replace(/^import /, "").replace(/;$/, ""));
    expect(texts.get(reporterUrl)).toContain("(function reportWorkers(");
    handedPort(started).close();
  });

  it("keeps a data: worker a data: URL, with the reporter in front", async () => {
    const { Worker } = await frame();
    new Worker("data:text/javascript,postMessage(%22ran%22)");
    new Worker(`data:text/javascript;base64,${btoa('"use strict";\npostMessage(1);')}`);
    const [plain, strict] = FakeWorker.started.map((w) => {
      expect(w.url.startsWith("data:text/javascript;charset=utf-8,")).toBe(true);
      return decodeURIComponent(w.url.slice(w.url.indexOf(",") + 1));
    });
    expect(plain).toContain("(function reportWorkers(");
    expect(plain.endsWith('\npostMessage("ran")')).toBe(true);
    // A strict script stays strict: the directive still comes first
    expect(strict.startsWith('"use strict";(function reportWorkers(')).toBe(true);
    for (const worker of FakeWorker.started) handedPort(worker).close();
  });

  it("starts other URLs as the browser would, with nothing added", async () => {
    const { Worker } = await frame();
    new Worker("https://example.org/worker.js");
    new Worker("data:text/javascript,%E0%A4%A");
    expect(FakeWorker.started.map((w) => [w.url, w.posted])).toEqual([
      ["https://example.org/worker.js", []],
      ["data:text/javascript,%E0%A4%A", []],
    ]);
  });

  describe("inside the worker", () => {
    /** Runs the reporter as a worker does, against a fake worker scope. */
    async function inWorker() {
      const { Worker, URLs, texts } = await frame();
      new Worker(URLs.createObjectURL(new EntryBlob(["x"])));
      const text = texts.get(FakeWorker.started[0].url) ?? "";
      handedPort(FakeWorker.started[0]).close();
      const start = text.slice(0, text.lastIndexOf("\nimportScripts("));
      const listeners = new Map<string, (event: unknown) => void>();
      const self = {
        addEventListener: (type: string, listener: (event: unknown) => void) =>
          listeners.set(type, listener),
        removeEventListener: (type: string) => listeners.delete(type),
      };
      new Function("self", start)(self);
      const violation = (blockedURI: string, isTrusted = true) =>
        listeners.get("securitypolicyviolation")?.({
          isTrusted,
          effectiveDirective: "connect-src",
          blockedURI,
        });
      return { listeners, violation };
    }

    it("takes the shell's port from the first message and holds reports until then", async () => {
      const { listeners, violation } = await inWorker();
      violation("https://early.example.org/x");
      violation("https://forged.example.org/x", false);

      const channel = new MessageChannel();
      const received: unknown[] = [];
      channel.port1.onmessage = (event) => received.push(event.data);
      const stop = vi.fn();
      // A message the plugin forged does not hand over a port
      listeners.get("message")?.({
        isTrusted: false,
        data: { type: "ws-worker-port" },
        ports: [new MessageChannel().port2],
        stopImmediatePropagation: stop,
      });
      expect(stop).not.toHaveBeenCalled();
      listeners.get("message")?.({
        isTrusted: true,
        data: { type: "ws-worker-port" },
        ports: [channel.port2],
        stopImmediatePropagation: stop,
      });
      // The plugin's listeners never see it, and the reporter stops listening
      expect(stop).toHaveBeenCalledOnce();
      expect(listeners.has("message")).toBe(false);
      violation("https://late.example.org/x");

      await until(() => received.length === 3);
      expect(received).toEqual([
        { t: "started" },
        { t: "csp", directive: "connect-src", blocked: "https://early.example.org/x" },
        { t: "csp", directive: "connect-src", blocked: "https://late.example.org/x" },
      ]);
      channel.port1.close();
    });
  });
});
