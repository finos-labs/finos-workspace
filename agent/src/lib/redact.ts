/**
 * Keeps secrets and what users wrote out of the logs.
 *
 * A model provider's error carries the whole request (every message of the conversation, a file's
 * bytes), and a presigned file URL is a working download link for an hour, so anything that is
 * logged goes through here first. Pure and free of imports, so the agent and the MCP server share it.
 */

const MAX_STRING = 2000;
/** How much of a string is looked through for secrets: what is kept, with room for what a redaction shortens. */
const MAX_SCAN = 4000;
const MAX_ARRAY = 20;
const MAX_DEPTH = 6;

// Fields that hold what a user sent or a provider received, in full. Never worth a log line.
const PAYLOAD_KEYS = new Set([
  "requestbodyvalues",
  "messages",
  "prompt",
  "content_b64",
  "data_base64",
  "base64",
]);

// A string under a key like these is a credential.
const SECRET_KEY = /authorization|cookie|password|passwd|secret|token|api[-_]?key|signature|credential/i;

const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
const KEY_SHAPED = /\b(?:nvapi|sk|gsk|xox[baprs])[-_][A-Za-z0-9_-]{16,}/g;
const URL_SECRET =
  /([?&](?:signature|x-amz-[a-z-]+|token|access_token|api[_-]?key|key|sig)=)[^&\s"']+/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const DATA_URL = /data:[\w/+.-]+;base64,[A-Za-z0-9+/=_-]{100,}/g;
const BASE64_BLOB = /^[A-Za-z0-9+/=_-]+$/;

/** A cut piece of text without the word the cut went through: half a secret is not a secret that a pattern finds. */
function whole(piece: string): string {
  for (let i = piece.length - 1; i >= piece.length - 300 && i > 0; i--) {
    const c = piece.charCodeAt(i);
    if (c === 32 || c === 10 || c === 9 || c === 13) return piece.slice(0, i);
  }
  return piece;
}

export function redactString(value: string): string {
  if (value.length > 200 && BASE64_BLOB.test(value)) return `[base64 ${value.length} chars]`;
  // Only the start of a string is ever kept (MAX_STRING), so only that much is looked through: a provider's
  // error repeats what the user sent, and a megabyte made to be slow for the patterns below (the e-mail
  // one starts again at every character of "a.a.a.a.") would stop the whole agent while it was redacted.
  const head = value.length > MAX_SCAN ? whole(value.slice(0, MAX_SCAN)) : value;
  let out = head
    .replace(DATA_URL, (m) => `data:[base64 ${m.length} chars]`)
    .replace(BEARER, "Bearer [redacted]")
    .replace(JWT, "[jwt]")
    .replace(KEY_SHAPED, "[key]")
    .replace(URL_SECRET, "$1[redacted]")
    .replace(EMAIL, "[email]");
  const unread = value.length - head.length;
  const more = Math.max(out.length - MAX_STRING, 0) + unread;
  if (more > 0) out = `${out.slice(0, MAX_STRING)}…[${more} more chars]`;
  return out;
}

function redactError(error: Error, depth: number, seen: WeakSet<object>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: error.name,
    message: redactString(error.message),
  };
  if (error.stack) out.stack = redactString(error.stack);
  for (const [key, value] of Object.entries(error)) {
    out[key] = redactEntry(key, value, depth + 1, seen);
  }
  return out;
}

function redactEntry(key: string, value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (PAYLOAD_KEYS.has(key.toLowerCase())) return "[omitted]";
  if (typeof value === "string" && SECRET_KEY.test(key)) return "[redacted]";
  return redactValue(value, depth, seen);
}

export function redactValue(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") {
    return typeof value === "function" || typeof value === "symbol" ? String(value) : value;
  }
  if (seen.has(value)) return "[circular]";
  if (depth >= MAX_DEPTH) return "[truncated]";
  seen.add(value);
  try {
    if (value instanceof Error) return redactError(value, depth, seen);
    if (Array.isArray(value)) {
      const items = value.slice(0, MAX_ARRAY).map((item) => redactValue(item, depth + 1, seen));
      if (value.length > MAX_ARRAY) items.push(`[${value.length - MAX_ARRAY} more items]`);
      return items;
    }
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = redactEntry(key, entry, depth + 1, seen);
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

/** The shape of a LogTape record, which is all this needs of it. */
interface RecordLike {
  readonly message: readonly unknown[];
  readonly properties: Record<string, unknown>;
}

/** The same record with its message and properties redacted. */
export function redactRecord<T extends RecordLike>(record: T): T {
  return {
    ...record,
    message: record.message.map((part) => (typeof part === "string" ? redactString(part) : redactValue(part))),
    properties: redactValue(record.properties) as Record<string, unknown>,
  };
}
