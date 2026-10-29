import { z } from "zod";

export const SHELL_READY = "ws-shell-ready";
export const SHELL_PORT = "ws-shell-port";
export const RUNTIME_VERSION = 1;
export const AFM_VERSION = "0.11";

export const MAX_GUEST_MESSAGE_BYTES = 1024 * 1024;
export const MAX_EXPORT_BYTES = 25 * 1024 * 1024;

const CanaryCheckSchema = z.object({
  name: z.string().max(64),
  ok: z.boolean(),
  detail: z.string().max(300).optional(),
});

const ErrorInfoSchema = z.object({
  name: z.string().max(64),
  message: z.string().max(2000),
});

export const GuestMessageSchema = z.discriminatedUnion("t", [
  z.object({
    t: z.literal("hello"),
    runtime: z.number(),
    afm: z.string().max(16),
    canary: z.array(CanaryCheckSchema).max(32),
  }),
  z.object({ t: z.literal("loaded"), exports: z.array(z.string().max(64)).max(16) }),
  z.object({
    t: z.literal("error"),
    phase: z.enum(["load", "initialize", "render", "runtime", "export"]),
    message: z.string().max(2000),
  }),
  z.object({
    t: z.literal("write"),
    traits: z.record(z.string().max(80), z.unknown()),
  }),
  z.object({
    t: z.literal("invoke"),
    id: z.number().int().nonnegative(),
    name: z.string().max(64),
    msg: z.unknown(),
    buffers: z.array(z.instanceof(ArrayBuffer)).max(8).optional(),
  }),
  z.object({
    t: z.literal("export-result"),
    id: z.number().int().nonnegative(),
    ok: z.boolean(),
    value: z.unknown().optional(),
    error: ErrorInfoSchema.optional(),
  }),
  z.object({ t: z.literal("pong"), seq: z.number().int() }),
  z.object({
    t: z.literal("csp"),
    directive: z.string().max(32),
    origin: z.string().max(255),
  }),
  z.object({
    t: z.literal("log"),
    level: z.enum(["debug", "info", "warn", "error"]),
    text: z.string().max(2000),
  }),
  z.object({ t: z.literal("disposed") }),
]);
export type GuestMessage = z.infer<typeof GuestMessageSchema>;

export type HostMessage =
  | {
      t: "load";
      entry: ArrayBuffer;
      styles: string[];
      state: Record<string, unknown>;
      writable: string[];
      permissions: string[];
      timeouts: { initialize: number; render: number };
    }
  | { t: "push"; traits: Record<string, unknown> }
  | { t: "echo"; traits: Record<string, unknown> }
  | {
      t: "result";
      id: number;
      ok: boolean;
      value?: unknown;
      buffers?: ArrayBuffer[];
      error?: { name: string; message: string };
    }
  | { t: "event"; content: unknown; buffers?: ArrayBuffer[] }
  | {
      t: "call-export";
      id: number;
      member: ExportMember;
      args: unknown[];
      timeout: number;
    }
  | { t: "ping"; seq: number }
  | { t: "scheme"; mode: ColorScheme }
  | { t: "dispose" };

export type ColorScheme = "light" | "dark";

export type ExportMember = "exportOptions" | "exportData" | "copilotContext";

export type CommandErrorName =
  | "not_granted"
  | "invalid_args"
  | "out_of_scope"
  | "rate_limited"
  | "too_large"
  | "unknown_command"
  | "timeout"
  | "unavailable";

export class CommandError extends Error {
  constructor(
    public readonly code: CommandErrorName,
    message: string,
  ) {
    super(message);
    this.name = code;
  }
}

export function approximateSize(
  value: unknown,
  limit = MAX_GUEST_MESSAGE_BYTES,
): number {
  let size = 0;
  const seen = new Set<unknown>();
  const visit = (item: unknown): void => {
    if (size > limit) return;
    if (item instanceof ArrayBuffer) {
      size += item.byteLength;
      return;
    }
    if (ArrayBuffer.isView(item)) {
      size += item.byteLength;
      return;
    }
    if (typeof Blob !== "undefined" && item instanceof Blob) {
      size += item.size;
      return;
    }
    if (typeof item === "string") {
      size += item.length * 2;
      return;
    }
    if (typeof item !== "object" || item === null) {
      size += 8;
      return;
    }
    if (seen.has(item)) return;
    seen.add(item);
    for (const [key, child] of Object.entries(item)) {
      size += key.length * 2;
      visit(child);
    }
  };
  visit(value);
  return size;
}
