/*
 * The shell of a widget plugin frame: the host side of the Anywidget front-end module
 * contract (AFM 0.11), running inside the sandboxed frame (docs/widget-plugins/
 * GUEST-CONTRACT.md, SECURITY.md 5).
 *
 * It is a classic script whose SHA-256 is in the frame's policy, identical for every
 * frame. It announces itself to the parent, takes the private port the host hands over
 * (and ignores every other window message), proves that the sandbox and the policy are
 * in force, and only then receives the verified bundle and evaluates it from a Blob URL.
 *
 * The shell is a convenience for plugin code, not a security boundary: the host checks
 * every message that arrives on the port against the plugin's permissions.
 */
(() => {
  const RUNTIME = 1;
  const AFM = "0.11";
  const MAX_REPORTS = 200;
  const MAX_LOGS = 50;
  const PROBE_HOST = "https://ws-canary.invalid";

  const root = document.getElementById("root");
  let config = {};
  try {
    config = JSON.parse(document.documentElement.getAttribute("data-ws") || "{}");
  } catch {
    config = {};
  }

  let port = null;
  let probing = true;
  const state = Object.create(null);
  const bound = new Set();
  const dirty = new Set();
  const listeners = new Map();
  const pending = new Map();
  let nextId = 1;
  const controller = new AbortController();
  const cleanups = [];
  let exportsObject = null;
  const violations = [];
  const reported = new Set();
  let logs = 0;
  let disposed = false;

  function post(message, transfer) {
    if (port) port.postMessage(message, transfer || []);
  }

  function describe(error) {
    if (error && typeof error === "object" && "message" in error)
      return String(error.message);
    return String(error);
  }

  function named(name, message) {
    const error = new Error(message);
    error.name = name;
    return error;
  }

  function clone(value) {
    return value === undefined ? undefined : structuredClone(value);
  }

  function same(a, b) {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }

  function emit(event, ...args) {
    const callbacks = listeners.get(event);
    if (!callbacks) return;
    for (const callback of [...callbacks]) {
      try {
        callback(...args);
      } catch (error) {
        log("error", `listener for ${event} threw: ${describe(error)}`);
      }
    }
  }

  function log(level, text) {
    if (logs >= MAX_LOGS) return;
    logs += 1;
    post({ t: "log", level, text: String(text).slice(0, 2000) });
  }

  // Requests the policy blocked: kept for the canary, and reported once the canary is done,
  // including what the plugin does while it initializes and renders
  function origin(blocked) {
    if (!blocked) return "inline";
    if (["inline", "eval", "wasm-eval"].includes(blocked)) return blocked;
    if (blocked.startsWith("data")) return "data";
    if (blocked.startsWith("blob")) return "blob";
    try {
      const url = new URL(blocked);
      return `${url.protocol}//${url.host}`;
    } catch {
      return "inline";
    }
  }

  document.addEventListener("securitypolicyviolation", (event) => {
    // Only what the browser blocked: plugin code can dispatch an event of its own
    if (!event.isTrusted) return;
    const directive = event.effectiveDirective || event.violatedDirective || "";
    const blocked = origin(event.blockedURI);
    violations.push({ directive, origin: blocked });
    if (probing || blocked === PROBE_HOST) return;
    const key = `${directive} ${blocked}`;
    if (reported.has(key) || reported.size >= MAX_REPORTS) return;
    reported.add(key);
    post({
      t: "csp",
      directive: directive.slice(0, 32),
      origin: blocked.slice(0, 255),
    });
  });

  window.addEventListener("error", (event) => log("error", event.message || "error"));
  window.addEventListener("unhandledrejection", (event) =>
    log("error", `unhandled rejection: ${describe(event.reason)}`),
  );

  // ---------------------------------------------------------------- canary

  function expectThrow(name, read) {
    try {
      read();
      return { name, ok: false, detail: "was readable" };
    } catch {
      return { name, ok: true };
    }
  }

  function indexedDbCheck() {
    return new Promise((resolve) => {
      let request;
      try {
        request = indexedDB.open("ws-canary");
      } catch {
        resolve({ name: "indexed-db", ok: true });
        return;
      }
      const done = (ok, detail) => resolve({ name: "indexed-db", ok, detail });
      request.onsuccess = () => done(false, "opened a database");
      request.onerror = () => done(true);
      setTimeout(() => done(true), 1000);
    });
  }

  const PROBES = {
    connect: {
      directives: ["connect-src"],
      run: () => fetch(`${PROBE_HOST}/c`).catch(() => undefined),
    },
    img: {
      directives: ["img-src"],
      run: () => {
        const image = new Image();
        image.src = `${PROBE_HOST}/i.png`;
      },
    },
    eval: {
      directives: ["script-src"],
      run: () => {
        try {
          new Function("return 1")();
        } catch {
          // a refused eval throws; the violation event is what the check waits for
        }
      },
    },
    inline: {
      directives: ["script-src", "script-src-elem"],
      run: () => {
        const script = document.createElement("script");
        script.textContent = "window.__wsInlineProbe = true;";
        document.head.appendChild(script);
        script.remove();
      },
    },
  };

  async function canary() {
    const checks = [
      { name: "opaque-origin", ok: self.origin === "null", detail: self.origin },
      expectThrow("local-storage", () => window.localStorage),
      expectThrow("session-storage", () => window.sessionStorage),
      expectThrow("cookie", () => document.cookie),
      expectThrow("parent-document", () => window.parent.document.body),
      await indexedDbCheck(),
    ];
    const probes = Array.isArray(config.probes) ? config.probes : [];
    for (const name of probes) {
      const probe = PROBES[name];
      if (!probe) {
        checks.push({ name: `policy-${name}`, ok: false, detail: "unknown probe" });
        continue;
      }
      const before = violations.length;
      try {
        await probe.run();
      } catch {
        // only the violation event counts
      }
      const seen = await new Promise((resolve) => {
        const deadline = Date.now() + 2000;
        const poll = () => {
          const found = violations
            .slice(before)
            .some((v) => probe.directives.includes(v.directive));
          if (found) resolve(true);
          else if (Date.now() > deadline) resolve(false);
          else setTimeout(poll, 25);
        };
        poll();
      });
      checks.push({
        name: `policy-${name}`,
        ok: seen && window.__wsInlineProbe !== true,
        detail: seen ? undefined : "the frame's policy was not applied",
      });
    }
    return checks;
  }

  // ----------------------------------------------------------------- model

  const model = {
    get(name) {
      return clone(state[name]);
    },
    set(name, value) {
      state[name] = clone(value);
      dirty.add(name);
      emit(`change:${name}`);
    },
    save_changes() {
      const traits = {};
      for (const name of dirty) if (bound.has(name)) traits[name] = state[name];
      dirty.clear();
      if (Object.keys(traits).length) post({ t: "write", traits });
    },
    on(event, callback) {
      if (typeof callback !== "function") return;
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(callback);
    },
    off(event, callback) {
      if (event === undefined || event === null) {
        listeners.clear();
        return;
      }
      if (callback === undefined) listeners.delete(event);
      else listeners.get(event)?.delete(callback);
    },
    // Only the message anywidget's own invoke sends: a host command, answered with a
    // msg:custom of the same id (GUEST-CONTRACT 3.4). Anything else is dropped and counted.
    send(content, _callbacks, buffers) {
      if (
        !content ||
        content.kind !== "anywidget-command" ||
        typeof content.name !== "string"
      ) {
        log(
          "warn",
          "model.send carries only anywidget commands; the message was dropped",
        );
        return;
      }
      invoke(content.name, content.msg, { buffers: buffers || [] }).then(
        ([response, views]) =>
          emit(
            "msg:custom",
            { id: content.id, kind: "anywidget-command-response", response },
            views,
          ),
        // No answer: the caller's own deadline ends the call
        (error) =>
          log("warn", `${content.name} was refused: ${error?.name || "Error"}`),
      );
    },
    widget_manager: {
      get_model() {
        return Promise.reject(named("not_available", "No cross-widget access"));
      },
    },
  };

  const host = {
    getWidget() {
      return Promise.reject(named("not_available", "No cross-widget access"));
    },
    getModel() {
      return Promise.reject(named("not_available", "No cross-widget access"));
    },
  };

  function toArrayBuffer(buffer) {
    if (buffer instanceof ArrayBuffer) return buffer;
    if (ArrayBuffer.isView(buffer))
      return buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      );
    throw named("invalid_args", "buffers are ArrayBuffers or views");
  }

  function invoke(name, msg, options) {
    const opts = options || {};
    return new Promise((resolve, reject) => {
      if (opts.signal?.aborted) {
        reject(named("AbortError", "aborted"));
        return;
      }
      const id = nextId++;
      let buffers;
      try {
        buffers = (opts.buffers || []).map(toArrayBuffer);
      } catch (error) {
        reject(error);
        return;
      }
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(named("timeout", `${name} did not answer in time`));
      }, opts.timeout || 10000);
      pending.set(id, { resolve, reject, timer });
      opts.signal?.addEventListener("abort", () => {
        if (!pending.has(id)) return;
        clearTimeout(timer);
        pending.delete(id);
        reject(named("AbortError", "aborted"));
      });
      post({ t: "invoke", id, name: String(name), msg: clone(msg), buffers }, buffers);
    });
  }

  const experimental = { invoke };

  function withTimeout(promise, ms, what) {
    return Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(named("timeout", `${what} took longer than ${ms} ms`)),
          ms,
        ),
      ),
    ]);
  }

  function keep(result) {
    if (typeof result === "function") cleanups.push(result);
    else if (result && typeof result === "object") exportsObject = result;
  }

  async function load(message) {
    for (const name of message.writable || []) bound.add(name);
    for (const [name, value] of Object.entries(message.state || {})) {
      state[name] = value;
      bound.add(name);
    }
    for (const css of message.styles || []) {
      const style = document.createElement("style");
      style.textContent = css;
      document.head.appendChild(style);
    }

    let module;
    const url = URL.createObjectURL(
      new Blob([message.entry], { type: "text/javascript" }),
    );
    try {
      module = await import(url);
    } catch (error) {
      post({ t: "error", phase: "load", message: describe(error) });
      return;
    } finally {
      URL.revokeObjectURL(url);
    }

    let widget = module.default;
    try {
      if (typeof widget === "function") widget = await widget();
    } catch (error) {
      post({ t: "error", phase: "load", message: describe(error) });
      return;
    }
    if (!widget || typeof widget !== "object") {
      post({ t: "error", phase: "load", message: "the module has no default export" });
      return;
    }

    const signal = controller.signal;
    const timeouts = message.timeouts || { initialize: 15000, render: 15000 };
    if (typeof widget.initialize === "function") {
      try {
        keep(
          await withTimeout(
            widget.initialize({ model, signal, experimental }),
            timeouts.initialize,
            "initialize",
          ),
        );
      } catch (error) {
        controller.abort();
        post({ t: "error", phase: "initialize", message: describe(error) });
        return;
      }
    }
    if (typeof widget.render === "function") {
      try {
        keep(
          await withTimeout(
            widget.render({ model, el: root, signal, host, experimental }),
            timeouts.render,
            "render",
          ),
        );
      } catch (error) {
        controller.abort();
        post({ t: "error", phase: "render", message: describe(error) });
        return;
      }
    }
    const exported = exportsObject
      ? ["exportOptions", "exportData", "copilotContext"].filter(
          (k) => typeof exportsObject[k] === "function",
        )
      : [];
    post({ t: "loaded", exports: exported });
  }

  function push(traits) {
    const changed = [];
    for (const [name, value] of Object.entries(traits)) {
      bound.add(name);
      if (!same(state[name], value)) changed.push(name);
      state[name] = value;
    }
    for (const name of changed) emit(`change:${name}`);
  }

  async function callExport(message) {
    const member = exportsObject?.[message.member];
    if (typeof member !== "function") {
      post({
        t: "export-result",
        id: message.id,
        ok: false,
        error: { name: "unavailable", message: `${message.member} is not exported` },
      });
      return;
    }
    try {
      const value = await withTimeout(
        member.apply(exportsObject, message.args || []),
        message.timeout || 10000,
        message.member,
      );
      post({ t: "export-result", id: message.id, ok: true, value });
    } catch (error) {
      post({
        t: "export-result",
        id: message.id,
        ok: false,
        error: { name: error?.name || "Error", message: describe(error) },
      });
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    controller.abort();
    for (const cleanup of cleanups.reverse()) {
      try {
        cleanup();
      } catch {
        // a failing cleanup does not stop the others
      }
    }
    listeners.clear();
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(named("unavailable", "the widget was closed"));
    }
    pending.clear();
    root.replaceChildren();
    post({ t: "disposed" });
    port?.close();
    port = null;
  }

  function onPortMessage(event) {
    const message = event.data;
    if (!message || typeof message !== "object") return;
    switch (message.t) {
      case "load":
        load(message);
        break;
      case "push":
      case "echo":
        push(message.traits || {});
        break;
      case "result": {
        const call = pending.get(message.id);
        if (!call) break;
        pending.delete(message.id);
        clearTimeout(call.timer);
        if (message.ok)
          call.resolve([
            message.value,
            (message.buffers || []).map((buffer) => new DataView(buffer)),
          ]);
        else
          call.reject(
            named(message.error?.name || "Error", message.error?.message || ""),
          );
        break;
      }
      case "event":
        emit(
          "msg:custom",
          message.content,
          (message.buffers || []).map((buffer) => new DataView(buffer)),
        );
        break;
      case "call-export":
        callExport(message);
        break;
      case "ping":
        post({ t: "pong", seq: message.seq });
        break;
      case "scheme":
        if (message.mode === "light" || message.mode === "dark")
          document.documentElement.style.colorScheme = message.mode;
        break;
      case "dispose":
        dispose();
        break;
      default:
        break;
    }
  }

  function onWindowMessage(event) {
    if (port || event.source !== window.parent) return;
    const data = event.data;
    if (!data || data.type !== "ws-shell-port" || !event.ports?.[0]) return;
    window.removeEventListener("message", onWindowMessage);
    port = event.ports[0];
    port.onmessage = onPortMessage;
    canary().then((checks) => {
      probing = false;
      post({ t: "hello", runtime: RUNTIME, afm: AFM, canary: checks });
    });
  }

  window.addEventListener("message", onWindowMessage);
  window.parent.postMessage({ type: "ws-shell-ready" }, "*");
})();
