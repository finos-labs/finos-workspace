export const STREAM_BATCH_MS = 100;
export const MAX_STREAM_BATCH = 200;
export const MAX_STREAM_MESSAGE_CHARS = 256_000;
export const STREAM_RETRY_MAX_MS = 15_000;

export type StreamState = "connecting" | "live" | "retrying" | "closed";

export interface SocketLike {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  close: () => void;
}

export type SocketFactory = (url: string) => SocketLike;

export interface StreamHandlers {
  onMessages: (messages: unknown[]) => void;
  onState: (state: StreamState, retryInSeconds?: number) => void;
  socket?: SocketFactory;
}

export interface Stream {
  close: () => void;
  reconnect: () => void;
}

export function webSocketUrl(href: string): string | null {
  try {
    const url = new URL(href);
    if (url.protocol === "http:") url.protocol = "ws:";
    else if (url.protocol === "https:") url.protocol = "wss:";
    return url.protocol === "ws:" || url.protocol === "wss:" ? url.href : null;
  } catch {
    return null;
  }
}

export function messageOf(data: unknown): { message: unknown } | null {
  if (
    typeof data !== "string" ||
    data.length === 0 ||
    data.length > MAX_STREAM_MESSAGE_CHARS
  )
    return null;
  try {
    return { message: JSON.parse(data) };
  } catch {
    return null;
  }
}

export function retryDelay(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, STREAM_RETRY_MAX_MS);
}

export function openStream(url: string, handlers: StreamHandlers): Stream {
  const open: SocketFactory =
    handlers.socket ?? ((target) => new WebSocket(target) as unknown as SocketLike);
  let socket: SocketLike | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let stopped = false;
  let buffer: unknown[] = [];
  const flusher = setInterval(() => flush(), STREAM_BATCH_MS);

  function flush() {
    if (buffer.length === 0) return;
    const messages = buffer;
    buffer = [];
    handlers.onMessages(messages);
  }

  function release(current: SocketLike) {
    current.onopen = null;
    current.onmessage = null;
    current.onclose = null;
    current.onerror = null;
    current.close();
  }

  function connect() {
    clearTimeout(retryTimer);
    if (socket) release(socket);
    socket = null;
    if (stopped) return;
    handlers.onState("connecting");
    const current = open(url);
    socket = current;
    let ended = false;
    const end = () => {
      if (ended || stopped || socket !== current) return;
      ended = true;
      release(current);
      socket = null;
      const delay = retryDelay(attempt);
      attempt += 1;
      handlers.onState("retrying", Math.round(delay / 1000));
      retryTimer = setTimeout(connect, delay);
    };
    current.onopen = () => {
      attempt = 0;
      handlers.onState("live");
    };
    current.onmessage = (event) => {
      const parsed = messageOf(event.data);
      if (!parsed) return;
      buffer.push(parsed.message);
      if (buffer.length >= MAX_STREAM_BATCH) flush();
    };
    current.onclose = end;
    current.onerror = end;
  }

  connect();

  return {
    close() {
      stopped = true;
      clearInterval(flusher);
      clearTimeout(retryTimer);
      if (socket) release(socket);
      socket = null;
      buffer = [];
      handlers.onState("closed");
    },
    reconnect() {
      if (stopped) return;
      attempt = 0;
      connect();
    },
  };
}
