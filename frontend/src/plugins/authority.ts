import { z } from "zod";
import type { ParamDef } from "~/components/types";
import { LINK_PROTOCOLS, MAX_EXPORT_OPTIONS } from "./limits";
import { CommandError, type CommandErrorName, MAX_EXPORT_BYTES } from "./protocol";
import { MAX_STATE_BYTES, type Permission, type PluginWidgetDef } from "./types";

type BindingSource =
  | "data"
  | "params"
  | "param"
  | "definition"
  | "config"
  | "adminSettings"
  | "state"
  | "theme"
  | "capabilities"
  | "meta";

export interface TraitBinding {
  trait: string;
  source: BindingSource;
  key?: string;
  writable: boolean;
}

const DEFAULT_SOURCES: BindingSource[] = [
  "data",
  "definition",
  "params",
  "config",
  "adminSettings",
  "state",
  "theme",
  "capabilities",
  "meta",
];

function parseBinding(bind: string): { source: BindingSource; key?: string } | null {
  const [head, ...rest] = bind.split(":");
  const key = rest.length ? rest.join(":") : undefined;
  if (head === "param" && key) return { source: "param", key };
  if ((head === "config" || head === "adminSettings") && key !== undefined)
    return { source: head, key };
  if (key === undefined && (DEFAULT_SOURCES as string[]).includes(head))
    return { source: head as BindingSource };
  return null;
}

export function traitBindings(
  widget: Pick<PluginWidgetDef, "model">,
  permissions: ReadonlySet<string>,
): TraitBinding[] {
  const canWrite = (source: BindingSource) =>
    ((source === "params" || source === "param") &&
      permissions.has("core:params:write")) ||
    (source === "state" && permissions.has("core:state:write"));
  const declared = widget.model?.traits;

  const bindings: TraitBinding[] = [];
  if (declared && Object.keys(declared).length) {
    for (const [trait, spec] of Object.entries(declared)) {
      const parsed = parseBinding(spec.bind);
      if (!parsed) continue;
      if (parsed.source === "data" && !permissions.has("core:data:read")) continue;
      bindings.push({
        trait,
        ...parsed,
        writable: spec.access === "readwrite" && canWrite(parsed.source),
      });
    }
    return bindings;
  }
  for (const source of DEFAULT_SOURCES) {
    if (source === "data" && !permissions.has("core:data:read")) continue;
    bindings.push({ trait: source, source, writable: canWrite(source) });
  }
  return bindings;
}

const MAX_TEXT_PARAM = 4096;

export function coerceParamValue(param: ParamDef, value: unknown): unknown {
  const multiple =
    ("multiSelect" in param && param.multiSelect) ||
    ("multiple" in param && param.multiple);
  if (multiple) {
    if (!Array.isArray(value) || value.length > 500)
      throw new CommandError(
        "invalid_args",
        `${param.paramName} takes a list of values`,
      );
    return value.map((item) =>
      coerceParamValue(
        { ...param, multiSelect: false, multiple: false } as ParamDef,
        item,
      ),
    );
  }
  switch (param.type) {
    case "number": {
      const number = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(number))
        throw new CommandError("invalid_args", `${param.paramName} takes a number`);
      return number;
    }
    case "boolean":
      if (typeof value !== "boolean")
        throw new CommandError(
          "invalid_args",
          `${param.paramName} takes true or false`,
        );
      return value;
    case "date":
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value))
        throw new CommandError(
          "invalid_args",
          `${param.paramName} takes a YYYY-MM-DD date`,
        );
      return value.slice(0, 32);
    default:
      if (typeof value !== "string" && typeof value !== "number")
        throw new CommandError("invalid_args", `${param.paramName} takes text`);
      if (String(value).length > MAX_TEXT_PARAM)
        throw new CommandError("too_large", `${param.paramName} is too long`);
      return String(value);
  }
}

export function jsonSize(value: unknown) {
  try {
    return new TextEncoder().encode(JSON.stringify(value ?? null)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function checkStateWrite(value: unknown) {
  if (jsonSize(value) > MAX_STATE_BYTES)
    throw new CommandError(
      "too_large",
      `state is limited to ${MAX_STATE_BYTES / 1024} KiB`,
    );
  return value;
}

export const COMMAND_PERMISSIONS: Record<string, Permission> = {
  "core:asset:read": "core:default",
  "core:ui:notify": "core:ui:notify",
  "core:ui:open-link": "core:ui:open-link",
  "core:clipboard:write": "core:clipboard:write",
  "core:download:save": "core:download:save",
  "core:proxy:call": "core:proxy:call",
  "core:backend:call": "core:backend:call",
};

const ASSET_PATH = /^assets\/[A-Za-z0-9._-]{1,128}(\/[A-Za-z0-9._-]{1,128})*$/;

export function assetPath(msg: Record<string, unknown>): string {
  const path = msg.path;
  if (
    typeof path !== "string" ||
    path.length > 512 ||
    !ASSET_PATH.test(path) ||
    path.split("/").some((part) => part === "." || part === "..")
  )
    throw new CommandError("invalid_args", "path names a file under assets/");
  return path;
}

export function commandPermission(name: string, permissions: ReadonlySet<string>) {
  const needed = COMMAND_PERMISSIONS[name];
  if (!needed)
    throw new CommandError("unknown_command", `${name} is not a host command`);
  if (!permissions.has(needed))
    throw new CommandError("not_granted", `${name} needs the permission ${needed}`);
}

const CALL_ERRORS: Record<string, CommandErrorName> = {
  invalid_args: "invalid_args",
  permission_denied: "not_granted",
  unknown_proxy: "out_of_scope",
  unknown_route: "out_of_scope",
  rate_limited: "rate_limited",
  busy: "rate_limited",
  timeout: "timeout",
  response_too_large: "too_large",
};

export function serverCallError(error: unknown): CommandError {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response
    ?.data?.detail;
  const { code, message } =
    detail && typeof detail === "object"
      ? (detail as { code?: unknown; message?: unknown })
      : { code: undefined, message: undefined };
  return new CommandError(
    (typeof code === "string" && CALL_ERRORS[code]) || "unavailable",
    typeof message === "string" ? message.slice(0, 300) : "the call failed",
  );
}

export function serverCallRequest(
  msg: Record<string, unknown>,
  key: "id" | "route",
  declared: string[],
) {
  const name = typeof msg[key] === "string" ? (msg[key] as string) : "";
  if (!declared.includes(name))
    throw new CommandError(
      "out_of_scope",
      `${name || `the ${key === "id" ? "proxy" : "route"}`} is not one this widget declares`,
    );
  const args = msg.args ?? {};
  if (typeof args !== "object" || args === null || Array.isArray(args))
    throw new CommandError("invalid_args", "args is an object");
  return { name, args: args as Record<string, unknown> };
}

export class RateLimiter {
  private tokens: number;
  private last: number;

  constructor(
    private readonly rate: number,
    private readonly burst: number,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.tokens = burst;
    this.last = now();
  }

  take(): boolean {
    const now = this.now();
    this.tokens = Math.min(
      this.burst,
      this.tokens + ((now - this.last) / 1000) * this.rate,
    );
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

export class ViolationCounter {
  private times: number[] = [];

  constructor(
    private readonly limit = 3,
    private readonly windowMs = 10_000,
    private readonly now: () => number = () => performance.now(),
  ) {}

  add(): boolean {
    const now = this.now();
    this.times = [...this.times.filter((t) => now - t < this.windowMs), now];
    return this.times.length >= this.limit;
  }
}

export function safeLink(url: unknown): string {
  if (typeof url !== "string" || url.length > 2048)
    throw new CommandError("invalid_args", "the link is a string");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new CommandError("invalid_args", "not a valid link");
  }
  if (!(LINK_PROTOCOLS as readonly string[]).includes(parsed.protocol))
    throw new CommandError("out_of_scope", "only https: and mailto: links open");
  return parsed.toString();
}

export const ExportOptionSchema = z
  .object({
    id: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/)
      .describe(
        "The id that the host passes to exportData. It is unique among the options.",
      ),
    label: z.string().min(1).max(60).describe("The text that the Export entry shows."),
    extension: z
      .string()
      .regex(/^[A-Za-z0-9]{1,10}$/)
      .describe("The extension of the file, without a dot."),
    mime: z
      .string()
      .max(192)
      .regex(/^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/)
      .describe("The MIME type of the file, in the form type/subtype."),
  })
  .strict();
type ExportOption = z.infer<typeof ExportOptionSchema>;

export function readExportOptions(value: unknown): ExportOption[] {
  const parsed = z
    .array(ExportOptionSchema)
    .max(MAX_EXPORT_OPTIONS)
    .safeParse(value ?? []);
  if (!parsed.success)
    throw new CommandError(
      "invalid_args",
      "exportOptions returns at most 16 of { id, label, extension, mime }",
    );
  const ids = parsed.data.map((option) => option.id);
  if (new Set(ids).size !== ids.length)
    throw new CommandError("invalid_args", "an export id is offered twice");
  return parsed.data;
}

export function exportFile(value: unknown, option: ExportOption): Blob | null {
  if (value === undefined || value === null) return null;
  const type = option.mime;
  let blob: Blob;
  if (typeof value === "string") blob = new Blob([value], { type });
  else if (value instanceof ArrayBuffer || ArrayBuffer.isView(value))
    blob = new Blob([value as BlobPart], { type });
  else if (value instanceof Blob) blob = new Blob([value], { type });
  else
    throw new CommandError(
      "invalid_args",
      "exportData returns a string, an ArrayBuffer, a typed array or a Blob",
    );
  if (blob.size > MAX_EXPORT_BYTES)
    throw new CommandError("too_large", "an export is at most 25 MiB");
  return blob;
}

export function safeFilename(name: unknown): string {
  const base = typeof name === "string" ? name : "download";
  const cleaned = [...base]
    .map((char) =>
      char.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(char) ? "_" : char,
    )
    .join("")
    .replace(/^\.+/, "")
    .slice(0, 120);
  return cleaned || "download";
}
