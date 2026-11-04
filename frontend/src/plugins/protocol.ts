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
  z
    .object({
      t: z.literal("hello"),
      runtime: z.number(),
      afm: z.string().max(16),
      canary: z.array(CanaryCheckSchema).max(32),
    })
    .describe("The shell is running and reports the result of its self-check."),
  z
    .object({ t: z.literal("loaded"), exports: z.array(z.string().max(64)).max(16) })
    .describe(
      "initialize and render have finished. The names are the members that initialize returned.",
    ),
  z
    .object({
      t: z.literal("error"),
      phase: z.enum(["load", "initialize", "render", "runtime", "export"]),
      message: z.string().max(2000),
    })
    .describe(
      "Something failed. The host only logs an error in the runtime phase and ends the frame for every other phase.",
    ),
  z
    .object({
      t: z.literal("write"),
      traits: z.record(z.string().max(80), z.unknown()),
    })
    .describe("The module called save_changes. The host answers with an echo message."),
  z
    .object({
      t: z.literal("invoke"),
      id: z.number().int().nonnegative(),
      name: z.string().max(64),
      msg: z.unknown(),
      buffers: z.array(z.instanceof(ArrayBuffer)).max(8).optional(),
    })
    .describe("The module calls a command."),
  z
    .object({
      t: z.literal("export-result"),
      id: z.number().int().nonnegative(),
      ok: z.boolean(),
      value: z.unknown().optional(),
      error: ErrorInfoSchema.optional(),
    })
    .describe("The module answers a call-export message."),
  z
    .object({ t: z.literal("pong"), seq: z.number().int() })
    .describe("The module answers a ping."),
  z
    .object({
      t: z.literal("csp"),
      directive: z.string().max(32),
      origin: z.string().max(255),
    })
    .describe("The policy blocked a request."),
  z
    .object({
      t: z.literal("log"),
      level: z.enum(["debug", "info", "warn", "error"]),
      text: z.string().max(2000),
    })
    .describe("The module wrote a log line."),
  z.object({ t: z.literal("disposed") }).describe("The module's cleanup has finished."),
]);
export type GuestMessage = z.infer<typeof GuestMessageSchema>;

export const COLOR_SCHEMES = ["light", "dark"] as const;
export type ColorScheme = (typeof COLOR_SCHEMES)[number];

export const EXPORT_MEMBERS = [
  "exportOptions",
  "exportData",
  "copilotContext",
] as const;
export type ExportMember = (typeof EXPORT_MEMBERS)[number];

export const COMMAND_ERRORS = [
  "not_granted",
  "invalid_args",
  "out_of_scope",
  "rate_limited",
  "too_large",
  "unknown_command",
  "timeout",
  "unavailable",
] as const;
export type CommandErrorName = (typeof COMMAND_ERRORS)[number];

export const HostMessageSchema = z.discriminatedUnion("t", [
  z
    .object({
      t: z.literal("load"),
      entry: z.instanceof(ArrayBuffer).describe("The module's bytes."),
      styles: z.array(z.string()).describe("The stylesheets of the plugin."),
      state: z
        .record(z.string(), z.unknown())
        .describe("The initial value of each bound trait."),
      writable: z.array(z.string()).describe("The traits that the module may write."),
      permissions: z
        .array(z.string())
        .describe("The permissions that the widget holds."),
      timeouts: z
        .object({ initialize: z.number(), render: z.number() })
        .describe("How long initialize and render may take, in milliseconds."),
    })
    .describe("The host delivers the module and its starting state."),
  z
    .object({ t: z.literal("push"), traits: z.record(z.string(), z.unknown()) })
    .describe(
      "The host reports changed trait values, and each change fires change:<trait> in the module.",
    ),
  z
    .object({ t: z.literal("echo"), traits: z.record(z.string(), z.unknown()) })
    .describe(
      "The host reports the writes that it accepted. A refused write comes back with the previous value.",
    ),
  z
    .object({
      t: z.literal("result"),
      id: z.number(),
      ok: z.boolean(),
      value: z.unknown().optional(),
      buffers: z.array(z.instanceof(ArrayBuffer)).optional(),
      error: z.object({ name: z.string(), message: z.string() }).optional(),
    })
    .describe("The host answers an invoke message."),
  z
    .object({
      t: z.literal("event"),
      content: z.unknown(),
      buffers: z.array(z.instanceof(ArrayBuffer)).optional(),
    })
    .describe(
      "The host sends an event to the module's msg:custom listeners, for example a refresh or a visibility change.",
    ),
  z
    .object({
      t: z.literal("call-export"),
      id: z.number(),
      member: z.enum(EXPORT_MEMBERS),
      args: z.array(z.unknown()),
      timeout: z.number(),
    })
    .describe("The host calls a member of the module's exports."),
  z
    .object({ t: z.literal("ping"), seq: z.number() })
    .describe("The host checks that the frame is alive."),
  z
    .object({ t: z.literal("scheme"), mode: z.enum(COLOR_SCHEMES) })
    .describe("The site's color mode changed."),
  z
    .object({ t: z.literal("dispose") })
    .describe("The host ends the widget, which aborts signal and runs the cleanups."),
]);
export type HostMessage = z.infer<typeof HostMessageSchema>;

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
