import {
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { postPluginReports } from "~/api/plugins.api";
import { RateLimiter, type TraitBinding, ViolationCounter } from "./authority";
import { BundleIntegrityError, loadBundle } from "./bundle";
import { buildSrcdoc, FRAME_SANDBOX } from "./frame";
import {
  EXPORT_TIMEOUTS_MS,
  GUEST_MESSAGE_RATE,
  LOAD_TIMEOUTS_MS,
  MAX_PENDING_COMMANDS,
  MAX_REPORTS_PER_FLUSH,
  MISSED_PINGS,
  PING_INTERVAL_MS,
  REPORT_INTERVAL_MS,
  VIOLATION_LIMIT,
} from "./limits";
import {
  AFM_VERSION,
  approximateSize,
  type ColorScheme,
  CommandError,
  type ExportMember,
  type GuestMessage,
  GuestMessageSchema,
  type HostMessage,
  MAX_EXPORT_BYTES,
  MAX_GUEST_MESSAGE_BYTES,
  RUNTIME_VERSION,
  SHELL_PORT,
  SHELL_READY,
} from "./protocol";
import type { AvailablePlugin } from "./types";

export type FrameStatus =
  | { kind: "booting" }
  | { kind: "loading" }
  | { kind: "running"; exports: string[] }
  | { kind: "sandbox-failed"; checks: string[] }
  | { kind: "integrity-failed"; detail: string }
  | { kind: "load-failed"; detail: string }
  | { kind: "plugin-error"; phase: string; detail: string }
  | { kind: "unresponsive" }
  | { kind: "ended"; detail: string };

export type FrameFailure = Exclude<
  FrameStatus,
  { kind: "booting" | "loading" | "running" }
>;

export interface PluginFrameHandle {
  callExport: (member: ExportMember, args: unknown[]) => Promise<unknown>;
  sendEvent: (content: unknown) => void;
  restart: () => void;
}

interface PluginFrameProps {
  plugin: AvailablePlugin;
  title: string;
  bindings: TraitBinding[];
  traits: Record<string, unknown>;
  permissions: string[];
  onWrite: (binding: TraitBinding, value: unknown) => unknown;
  onCommand: (
    name: string,
    msg: unknown,
    buffers: ArrayBuffer[],
  ) => Promise<{ value?: unknown; buffers?: ArrayBuffer[] }>;
  onStatus: (status: FrameStatus) => void;
  colorScheme: ColorScheme;
  visible?: boolean;
  handleRef?: Ref<PluginFrameHandle>;
}

function post(
  port: MessagePort | null,
  message: HostMessage,
  transfer: Transferable[] = [],
) {
  port?.postMessage(message, transfer);
}

export default function PluginFrame(props: PluginFrameProps) {
  const { plugin, title, colorScheme, visible = true, handleRef } = props;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [srcdoc, setSrcdoc] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);

  const latest = useRef(props);
  latest.current = props;

  const session = useRef<{
    port: MessagePort | null;
    handedOver: boolean;
    loads: number;
    running: boolean;
    sentTraits: Record<string, string>;
    sentRefs: Record<string, unknown>;
    pendingCommands: number;
    pendingExports: Map<
      number,
      {
        member: ExportMember;
        resolve: (v: unknown) => void;
        reject: (e: Error) => void;
      }
    >;
    nextExport: number;
    missedPings: number;
    pingSeq: number;
    reports: Map<string, { directive: string; origin: string }>;
    limiter: RateLimiter;
    violations: ViolationCounter;
    ended: boolean;
  }>(null as never);

  const resetSession = useCallback(() => {
    session.current = {
      port: null,
      handedOver: false,
      loads: 0,
      running: false,
      sentTraits: {},
      sentRefs: {},
      pendingCommands: 0,
      pendingExports: new Map(),
      nextExport: 1,
      missedPings: 0,
      pingSeq: 0,
      reports: new Map(),
      limiter: new RateLimiter(GUEST_MESSAGE_RATE.perSecond, GUEST_MESSAGE_RATE.burst),
      violations: new ViolationCounter(VIOLATION_LIMIT.count, VIOLATION_LIMIT.windowMs),
      ended: false,
    };
  }, []);
  if (!session.current) resetSession();

  const status = useCallback((next: FrameStatus) => latest.current.onStatus(next), []);

  const end = useCallback(
    (next: FrameFailure) => {
      const current = session.current;
      if (current.ended) return;
      current.ended = true;
      current.running = false;
      try {
        post(current.port, { t: "dispose" });
      } catch {}
      current.port?.close();
      current.port = null;
      for (const pending of current.pendingExports.values())
        pending.reject(new Error("the widget stopped"));
      current.pendingExports.clear();
      status(next);
      setSrcdoc(null);
      postPluginReports({
        plugin_id: plugin.id,
        version: plugin.version,
        failure: next.kind,
      }).catch(() => undefined);
    },
    [status, plugin.id, plugin.version],
  );

  const protocolViolation = useCallback(
    (reason: string) => {
      if (import.meta.env.DEV) console.warn(`[plugin ${plugin.id}] ${reason}`);
      if (session.current.violations.add()) end({ kind: "ended", detail: reason });
    },
    [end, plugin.id],
  );

  const flushReports = useCallback(
    (everything = false) => {
      const current = session.current;
      do {
        if (!current.reports.size) return;
        const batch = [...current.reports.entries()].slice(0, MAX_REPORTS_PER_FLUSH);
        for (const [key] of batch) current.reports.delete(key);
        postPluginReports({
          plugin_id: plugin.id,
          version: plugin.version,
          reports: batch.map(([, report]) => report),
        }).catch(() => undefined);
      } while (everything);
    },
    [plugin.id, plugin.version],
  );

  const pushTraits = useCallback((force = false) => {
    const current = session.current;
    if (!(current.port && (current.running || force))) return;
    const changed: Record<string, unknown> = {};
    for (const binding of latest.current.bindings) {
      const value = latest.current.traits[binding.trait];
      if (Object.is(current.sentRefs[binding.trait], value)) continue;
      current.sentRefs[binding.trait] = value;
      const serialized = JSON.stringify(value ?? null);
      if (current.sentTraits[binding.trait] !== serialized) {
        current.sentTraits[binding.trait] = serialized;
        changed[binding.trait] = value;
      }
    }
    if (Object.keys(changed).length) post(current.port, { t: "push", traits: changed });
  }, []);

  const handleGuest = useCallback(
    async (message: GuestMessage) => {
      const current = session.current;
      const port = current.port;
      switch (message.t) {
        case "hello": {
          const failed = message.canary.filter((check) => !check.ok);
          let readable = false;
          try {
            readable = iframeRef.current?.contentDocument !== null;
          } catch {
            readable = false;
          }
          if (readable) failed.push({ name: "host-isolation", ok: false });
          if (message.runtime !== RUNTIME_VERSION || message.afm !== AFM_VERSION)
            failed.push({ name: "runtime-version", ok: false });
          if (failed.length || !message.canary.length) {
            end({
              kind: "sandbox-failed",
              checks: failed.map((c) => (c.detail ? `${c.name}: ${c.detail}` : c.name)),
            });
            return;
          }
          status({ kind: "loading" });
          let bundle: Awaited<ReturnType<typeof loadBundle>>;
          try {
            bundle = await loadBundle(plugin);
          } catch (error) {
            if (error instanceof BundleIntegrityError)
              end({
                kind: "integrity-failed",
                detail: `${error.path}: expected ${error.expected}`,
              });
            else
              end({
                kind: "load-failed",
                detail: error instanceof Error ? error.message : String(error),
              });
            return;
          }
          if (current.ended || current.port !== port) return;
          const { bindings, traits, permissions } = latest.current;
          const state: Record<string, unknown> = {};
          for (const binding of bindings) {
            state[binding.trait] = traits[binding.trait];
            current.sentTraits[binding.trait] = JSON.stringify(
              traits[binding.trait] ?? null,
            );
          }
          post(
            port,
            {
              t: "load",
              entry: bundle.entry,
              styles: bundle.styles,
              state,
              writable: bindings.filter((b) => b.writable).map((b) => b.trait),
              permissions,
              timeouts: {
                initialize: LOAD_TIMEOUTS_MS.initialize,
                render: LOAD_TIMEOUTS_MS.render,
              },
            },
            [bundle.entry],
          );
          return;
        }
        case "loaded":
          current.running = true;
          status({ kind: "running", exports: message.exports });
          pushTraits();
          return;
        case "error":
          if (message.phase === "runtime") return;
          end({ kind: "plugin-error", phase: message.phase, detail: message.message });
          return;
        case "write": {
          const accepted: Record<string, unknown> = {};
          for (const [trait, value] of Object.entries(message.traits)) {
            const binding = latest.current.bindings.find((b) => b.trait === trait);
            const previous = latest.current.traits[trait];
            if (!binding?.writable) {
              accepted[trait] = previous;
              continue;
            }
            try {
              accepted[trait] = latest.current.onWrite(binding, value);
            } catch (error) {
              accepted[trait] = previous;
              if (!(error instanceof CommandError)) throw error;
            }
            current.sentTraits[trait] = JSON.stringify(accepted[trait] ?? null);
          }
          post(port, { t: "echo", traits: accepted });
          return;
        }
        case "invoke": {
          if (current.pendingCommands >= MAX_PENDING_COMMANDS) {
            post(port, {
              t: "result",
              id: message.id,
              ok: false,
              error: { name: "rate_limited", message: "too many pending commands" },
            });
            return;
          }
          current.pendingCommands += 1;
          try {
            const result = await latest.current.onCommand(
              message.name,
              message.msg,
              message.buffers ?? [],
            );
            post(
              current.port,
              { t: "result", id: message.id, ok: true, ...result },
              result.buffers ?? [],
            );
          } catch (error) {
            const name = error instanceof CommandError ? error.code : "unavailable";
            const text = error instanceof Error ? error.message : String(error);
            post(current.port, {
              t: "result",
              id: message.id,
              ok: false,
              error: { name, message: text },
            });
          } finally {
            current.pendingCommands -= 1;
          }
          return;
        }
        case "export-result": {
          const pending = current.pendingExports.get(message.id);
          if (!pending) return;
          current.pendingExports.delete(message.id);
          if (message.ok) pending.resolve(message.value);
          else pending.reject(new Error(message.error?.message ?? "the export failed"));
          return;
        }
        case "pong":
          current.missedPings = 0;
          return;
        case "csp": {
          const key = `${message.directive} ${message.origin}`;
          if (current.reports.size < 200)
            current.reports.set(key, {
              directive: message.directive,
              origin: message.origin,
            });
          return;
        }
        case "log":
          if (import.meta.env.DEV)
            console.debug(`[plugin ${plugin.id}] ${message.text}`);
          return;
        case "disposed":
          return;
      }
    },
    [end, plugin, pushTraits, status],
  );

  useEffect(() => {
    let cancelled = false;
    resetSession();
    status({ kind: "booting" });
    buildSrcdoc(plugin.csp, latest.current.colorScheme)
      .then((doc) => {
        if (!cancelled) setSrcdoc(doc);
      })
      .catch((error) =>
        status({
          kind: "load-failed",
          detail: error instanceof Error ? error.message : String(error),
        }),
      );
    return () => {
      cancelled = true;
      const current = session.current;
      flushReports(true);
      if (!current.ended) {
        current.ended = true;
        try {
          post(current.port, { t: "dispose" });
        } catch {}
        current.port?.close();
      }
    };
  }, [plugin.id, plugin.digest, JSON.stringify(plugin.csp), generation]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frameWindow = iframeRef.current?.contentWindow;
      if (!frameWindow || event.source !== frameWindow) return;
      const current = session.current;
      if (current.handedOver || current.ended) return;
      if (!event.data || event.data.type !== SHELL_READY) return;
      current.handedOver = true;
      const channel = new MessageChannel();
      current.port = channel.port1;
      channel.port1.onmessage = (portEvent) => {
        if (current.ended || current.port !== channel.port1) return;
        if (!current.limiter.take()) {
          protocolViolation("message rate exceeded");
          return;
        }
        const data = portEvent.data as { t?: unknown; id?: unknown } | null;
        const answersExport =
          data?.t === "export-result" &&
          typeof data.id === "number" &&
          current.pendingExports.get(data.id)?.member === "exportData";
        const limit = answersExport ? MAX_EXPORT_BYTES : MAX_GUEST_MESSAGE_BYTES;
        if (approximateSize(portEvent.data, limit) > limit) {
          protocolViolation("message too large");
          return;
        }
        const parsed = GuestMessageSchema.safeParse(portEvent.data);
        if (!parsed.success) {
          protocolViolation("message not understood");
          return;
        }
        handleGuest(parsed.data).catch((error) =>
          protocolViolation(error instanceof Error ? error.message : String(error)),
        );
      };
      frameWindow.postMessage({ type: SHELL_PORT }, "*", [channel.port2]);
      post(channel.port1, { t: "scheme", mode: latest.current.colorScheme });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [handleGuest, protocolViolation]);

  useEffect(() => {
    pushTraits();
  });

  useEffect(() => {
    const ping = setInterval(() => {
      const current = session.current;
      if (!(current.running && visible) || current.ended) return;
      if (current.missedPings >= MISSED_PINGS) {
        end({ kind: "unresponsive" });
        return;
      }
      current.missedPings += 1;
      current.pingSeq += 1;
      post(current.port, { t: "ping", seq: current.pingSeq });
    }, PING_INTERVAL_MS);
    const reports = setInterval(() => flushReports(), REPORT_INTERVAL_MS);
    return () => {
      clearInterval(ping);
      clearInterval(reports);
    };
  }, [end, flushReports, visible]);

  useEffect(() => {
    const current = session.current;
    if (current.running)
      post(current.port, {
        t: "event",
        content: { kind: "workspace-event", name: "visibility", visible },
      });
  }, [visible]);

  useEffect(() => {
    post(session.current.port, { t: "scheme", mode: colorScheme });
  }, [colorScheme]);

  useImperativeHandle(
    handleRef,
    () => ({
      callExport: (member, args) =>
        new Promise((resolve, reject) => {
          const current = session.current;
          if (!(current.running && current.port)) {
            reject(new Error("the widget is not running"));
            return;
          }
          const id = current.nextExport++;
          const timeout = EXPORT_TIMEOUTS_MS[member];
          const timer = setTimeout(() => {
            current.pendingExports.delete(id);
            reject(new Error(`${member} did not answer in time`));
          }, timeout + 2000);
          current.pendingExports.set(id, {
            member,
            resolve: (value) => {
              clearTimeout(timer);
              resolve(value);
            },
            reject: (error) => {
              clearTimeout(timer);
              reject(error);
            },
          });
          post(current.port, { t: "call-export", id, member, args, timeout });
        }),
      sendEvent: (content) => {
        const current = session.current;
        if (current.running) post(current.port, { t: "event", content });
      },
      restart: () => setGeneration((value) => value + 1),
    }),
    [],
  );

  if (!srcdoc) return null;

  return (
    <iframe
      key={`${plugin.digest}-${generation}`}
      ref={iframeRef}
      title={title}
      sandbox={FRAME_SANDBOX}
      referrerPolicy="no-referrer"
      srcDoc={srcdoc}
      className="block h-full w-full border-0 bg-transparent"
      onLoad={() => {
        const current = session.current;
        current.loads += 1;
        if (current.loads > 1)
          end({ kind: "ended", detail: "the frame navigated away" });
      }}
    />
  );
}
