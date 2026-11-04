import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TraitBinding } from "~/plugins/authority";
import { BundleIntegrityError, loadBundle } from "~/plugins/bundle";
import PluginFrame, {
  type FrameStatus,
  type PluginFrameProps,
} from "~/plugins/PluginFrame";
import { AFM_VERSION, RUNTIME_VERSION, SHELL_READY } from "~/plugins/protocol";
import type { AvailablePlugin } from "~/plugins/types";

vi.mock("~/plugins/frame", () => ({
  FRAME_SANDBOX: "allow-scripts",
  buildSrcdoc: async () => "<!doctype html><html><head></head><body></body></html>",
}));
vi.mock("~/plugins/bundle", async (original) => ({
  ...(await original<typeof import("~/plugins/bundle")>()),
  loadBundle: vi.fn(),
}));
vi.mock("~/api/plugins.api", () => ({
  postPluginReports: vi.fn(async () => undefined),
}));

type Message = { t: string; [key: string]: unknown };

const PLUGIN: AvailablePlugin = {
  id: "test-plugin",
  version: "1.0.0",
  name: "Test plugin",
  description: "",
  publisher: null,
  digest: `sha256-${"A".repeat(43)}`,
  entry: { module: "entry.js", styles: [] },
  files: { "entry.js": { size: 17, sha256: "0".repeat(64) } },
  csp: {},
  adminSettings: {},
  widgets: [],
};

const FILTER: TraitBinding = {
  trait: "filter",
  source: "param",
  key: "filter",
  writable: true,
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

function frameProps(overrides: Partial<PluginFrameProps> = {}) {
  const statuses: FrameStatus[] = [];
  const props: PluginFrameProps = {
    plugin: PLUGIN,
    title: "Widget (Test plugin)",
    bindings: [FILTER],
    traits: { filter: "all" },
    permissions: ["core:default", "core:params:write"],
    onWrite: vi.fn((_binding, value) => value),
    onCommand: vi.fn(async () => ({})),
    onStatus: (status) => statuses.push(status),
    colorScheme: "dark",
    ...overrides,
  };
  return { props, statuses };
}

async function frameNamed(title: string) {
  let found: HTMLIFrameElement | null = null;
  await vi.waitFor(() => {
    found = document.querySelector<HTMLIFrameElement>(`iframe[title="${title}"]`);
    expect(found).not.toBeNull();
  });
  const frame = found as unknown as HTMLIFrameElement;
  Object.defineProperty(frame, "contentDocument", { get: () => null });
  return frame;
}

async function handOver(frame: HTMLIFrameElement) {
  const win = frame.contentWindow as Window;
  const ports: MessagePort[] = [];
  vi.spyOn(win, "postMessage").mockImplementation((...args: unknown[]) => {
    const transfer = args[2] as Transferable[] | undefined;
    if (transfer?.[0]) ports.push(transfer[0] as MessagePort);
  });
  const announce = (source: Window) =>
    window.dispatchEvent(
      new MessageEvent("message", { data: { type: SHELL_READY }, source }),
    );
  return { win, ports, announce };
}

function listen(port: MessagePort, answerPings = false) {
  const received: Message[] = [];
  port.onmessage = (event) => {
    const message = event.data as Message;
    received.push(message);
    if (answerPings && message.t === "ping")
      port.postMessage({ t: "pong", seq: message.seq });
  };
  return received;
}

async function start(frame: HTMLIFrameElement, answerPings = false) {
  const { win, ports, announce } = await handOver(frame);
  announce(win);
  await vi.waitFor(() => expect(ports).toHaveLength(1));
  const port = ports[0];
  const received = listen(port, answerPings);
  port.postMessage({
    t: "hello",
    runtime: RUNTIME_VERSION,
    afm: AFM_VERSION,
    canary: [{ name: "opaque-origin", ok: true }],
  });
  await vi.waitFor(() => expect(received.some((m) => m.t === "load")).toBe(true));
  port.postMessage({ t: "loaded", exports: [] });
  return { port, received, win, ports, announce };
}

beforeEach(() => {
  vi.mocked(loadBundle).mockImplementation(async () => ({
    entry: new TextEncoder().encode("export default {}").buffer,
    styles: [],
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the watchdog", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] }));

  it("ends a running frame that misses three pings, as not responding, and removes it", async () => {
    const { props, statuses } = frameProps();
    const { container } = render(<PluginFrame {...props} />);
    const { received } = await start(await frameNamed(props.title));
    await vi.waitFor(() => expect(statuses.at(-1)?.kind).toBe("running"));
    for (let i = 0; i < 3; i++) {
      await act(() => vi.advanceTimersByTimeAsync(5000));
      await tick();
    }
    expect(received.filter((m) => m.t === "ping")).toHaveLength(3);
    expect(statuses.at(-1)?.kind).toBe("running");
    await act(() => vi.advanceTimersByTimeAsync(5000));
    await vi.waitFor(() => expect(statuses.at(-1)).toEqual({ kind: "unresponsive" }));
    await vi.waitFor(() => expect(received.at(-1)).toEqual({ t: "dispose" }));
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("keeps a frame that answers its pings", async () => {
    const { props, statuses } = frameProps();
    render(<PluginFrame {...props} />);
    const { received } = await start(await frameNamed(props.title), true);
    await vi.waitFor(() => expect(statuses.at(-1)?.kind).toBe("running"));
    for (let i = 0; i < 8; i++) {
      await act(() => vi.advanceTimersByTimeAsync(5000));
      await tick();
    }
    expect(received.filter((m) => m.t === "ping").length).toBeGreaterThanOrEqual(8);
    expect(statuses.some((s) => s.kind === "unresponsive")).toBe(false);
  });

  it("does not ping a frame that is not visible", async () => {
    const { props, statuses } = frameProps({ visible: false });
    render(<PluginFrame {...props} />);
    const { received } = await start(await frameNamed(props.title));
    await vi.waitFor(() => expect(statuses.at(-1)?.kind).toBe("running"));
    for (let i = 0; i < 6; i++) {
      await act(() => vi.advanceTimersByTimeAsync(5000));
      await tick();
    }
    expect(received.some((m) => m.t === "ping")).toBe(false);
    expect(statuses.some((s) => s.kind === "unresponsive")).toBe(false);
  });
});

describe("a frame that navigates itself", () => {
  it("is ended when its document loads a second time, and removed", async () => {
    const { props, statuses } = frameProps();
    const { container } = render(<PluginFrame {...props} />);
    const frame = await frameNamed(props.title);
    await start(frame);
    await vi.waitFor(() => expect(statuses.at(-1)?.kind).toBe("running"));
    fireEvent.load(frame);
    fireEvent.load(frame);
    await vi.waitFor(() =>
      expect(statuses.at(-1)).toEqual({
        kind: "ended",
        detail: "the frame navigated away",
      }),
    );
    expect(container.querySelector("iframe")).toBeNull();
  });
});

describe("files that fail the host's check", () => {
  it("send no code into the frame and end it as an integrity failure", async () => {
    vi.mocked(loadBundle).mockRejectedValue(
      new BundleIntegrityError("entry.js", "0".repeat(64), "f".repeat(64)),
    );
    const { props, statuses } = frameProps();
    const { container } = render(<PluginFrame {...props} />);
    const { win, ports, announce } = await handOver(await frameNamed(props.title));
    announce(win);
    await vi.waitFor(() => expect(ports).toHaveLength(1));
    const received = listen(ports[0]);
    ports[0].postMessage({
      t: "hello",
      runtime: RUNTIME_VERSION,
      afm: AFM_VERSION,
      canary: [{ name: "opaque-origin", ok: true }],
    });
    await vi.waitFor(() =>
      expect(statuses.at(-1)).toEqual({
        kind: "integrity-failed",
        detail: `entry.js: expected ${"0".repeat(64)}`,
      }),
    );
    await tick();
    expect(received.some((m) => m.t === "load")).toBe(false);
    expect(container.querySelector("iframe")).toBeNull();
  });
});

describe("a frame's identity is its port", () => {
  it("hands no port to a window that is not the frame's own", async () => {
    const { props } = frameProps();
    render(<PluginFrame {...props} />);
    const { win, ports, announce } = await handOver(await frameNamed(props.title));
    const other = document.createElement("iframe");
    document.body.append(other);
    announce(window);
    announce(other.contentWindow as Window);
    window.dispatchEvent(new MessageEvent("message", { data: { type: SHELL_READY } }));
    await tick();
    expect(ports).toHaveLength(0);
    announce(win);
    await vi.waitFor(() => expect(ports).toHaveLength(1));
    other.remove();
  });

  it("hands its frame one port only, however often the frame asks", async () => {
    const { props } = frameProps();
    render(<PluginFrame {...props} />);
    const { win, ports, announce } = await handOver(await frameNamed(props.title));
    announce(win);
    await vi.waitFor(() => expect(ports).toHaveLength(1));
    announce(win);
    announce(win);
    await tick();
    expect(ports).toHaveLength(1);
  });

  it("acts for the frame that owns the port and for no other frame", async () => {
    const a = frameProps({
      title: "First (Test plugin)",
      onWrite: vi.fn((_b, v) => v),
    });
    const b = frameProps({
      title: "Second (Test plugin)",
      onWrite: vi.fn((_b, v) => v),
    });
    render(
      <>
        <PluginFrame {...a.props} />
        <PluginFrame {...b.props} />
      </>,
    );
    const first = await start(await frameNamed(a.props.title));
    const second = await start(await frameNamed(b.props.title));
    await vi.waitFor(() => expect(a.statuses.at(-1)?.kind).toBe("running"));
    await vi.waitFor(() => expect(b.statuses.at(-1)?.kind).toBe("running"));
    first.port.postMessage({ t: "write", traits: { filter: "from the first" } });
    await vi.waitFor(() =>
      expect(first.received.some((m) => m.t === "echo")).toBe(true),
    );
    expect(a.props.onWrite).toHaveBeenCalledWith(FILTER, "from the first");
    expect(b.props.onWrite).not.toHaveBeenCalled();
    expect(second.received.some((m) => m.t === "echo")).toBe(false);
    first.win.dispatchEvent(
      new MessageEvent("message", {
        data: { t: "write", traits: { filter: "forged" } },
      }),
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { t: "write", traits: { filter: "forged" } },
        source: second.win,
      }),
    );
    await tick();
    expect(b.props.onWrite).not.toHaveBeenCalled();
    expect(a.props.onWrite).toHaveBeenCalledTimes(1);
  });
});
