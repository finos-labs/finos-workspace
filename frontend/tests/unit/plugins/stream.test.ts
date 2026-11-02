import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_STREAM_BATCH,
  MAX_STREAM_MESSAGE_CHARS,
  messageOf,
  openStream,
  retryDelay,
  type SocketLike,
  STREAM_BATCH_MS,
  STREAM_RETRY_MAX_MS,
  webSocketUrl,
} from "~/plugins/stream";

class FakeSocket implements SocketLike {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {}

  close() {
    this.closed = true;
  }

  open() {
    this.onopen?.();
  }

  send(data: unknown) {
    this.onmessage?.({ data });
  }

  drop() {
    this.onclose?.();
  }

  fail() {
    this.onerror?.();
    this.onclose?.();
  }
}

describe("webSocketUrl", () => {
  it("turns http into ws and https into wss, and keeps the path and the query", () => {
    expect(webSocketUrl("http://backend:7798/ws/ticks?key=k")).toBe(
      "ws://backend:7798/ws/ticks?key=k",
    );
    expect(webSocketUrl("https://backend/ws")).toBe("wss://backend/ws");
    expect(webSocketUrl("wss://backend/ws")).toBe("wss://backend/ws");
  });

  it("refuses what is not an address of a socket", () => {
    expect(webSocketUrl("ftp://backend/ws")).toBeNull();
    expect(webSocketUrl("/ws/ticks")).toBeNull();
    expect(webSocketUrl("nonsense")).toBeNull();
  });
});

describe("messageOf", () => {
  it("reads a JSON text message", () => {
    expect(messageOf('{"op":"upsert"}')).toEqual({ message: { op: "upsert" } });
    expect(messageOf("[1,2]")).toEqual({ message: [1, 2] });
  });

  it("drops what is not a message: not JSON, too long, empty or binary", () => {
    for (const data of ["", "nope", new ArrayBuffer(4), new Uint8Array(2), null, 7])
      expect(messageOf(data)).toBeNull();
    expect(messageOf(`"${"x".repeat(MAX_STREAM_MESSAGE_CHARS)}"`)).toBeNull();
  });
});

describe("retryDelay", () => {
  it("doubles from a second up to the cap", () => {
    expect([0, 1, 2, 3].map(retryDelay)).toEqual([1000, 2000, 4000, 8000]);
    expect(retryDelay(10)).toBe(STREAM_RETRY_MAX_MS);
  });
});

describe("openStream", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = () => {
    const sockets: FakeSocket[] = [];
    const socket = vi.fn((url: string) => {
      const made = new FakeSocket(url);
      sockets.push(made);
      return made;
    });
    const onMessages = vi.fn();
    const onState = vi.fn();
    const stream = openStream("ws://backend/stream?key=k", {
      onMessages,
      onState,
      socket,
    });
    return { stream, onMessages, onState, sockets };
  };

  it("opens the address it is given, and is live once the socket is open", () => {
    const { stream, sockets, onState } = setup();
    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toBe("ws://backend/stream?key=k");
    expect(onState).toHaveBeenLastCalledWith("connecting");
    sockets[0].open();
    expect(onState).toHaveBeenLastCalledWith("live");
    stream.close();
  });

  it("hands over the messages in batches, in order", async () => {
    const { stream, onMessages, sockets } = setup();
    sockets[0].open();
    sockets[0].send('{"op":"snapshot","rows":[]}');
    sockets[0].send('{"op":"upsert","rows":[{"id":1}]}');
    expect(onMessages).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(STREAM_BATCH_MS);
    expect(onMessages).toHaveBeenCalledTimes(1);
    expect(onMessages).toHaveBeenCalledWith([
      { op: "snapshot", rows: [] },
      { op: "upsert", rows: [{ id: 1 }] },
    ]);
    stream.close();
  });

  it("drops what is not a message", async () => {
    const { stream, onMessages, sockets } = setup();
    sockets[0].open();
    sockets[0].send("not json");
    sockets[0].send(new ArrayBuffer(8));
    sockets[0].send(`"${"x".repeat(MAX_STREAM_MESSAGE_CHARS)}"`);
    sockets[0].send('{"ok":true}');
    await vi.advanceTimersByTimeAsync(STREAM_BATCH_MS);
    expect(onMessages).toHaveBeenCalledWith([{ ok: true }]);
    stream.close();
  });

  it("sends a full batch at once", () => {
    const { stream, onMessages, sockets } = setup();
    sockets[0].open();
    for (let i = 0; i < MAX_STREAM_BATCH; i += 1)
      sockets[0].send(JSON.stringify({ i }));
    expect(onMessages).toHaveBeenCalledTimes(1);
    expect(onMessages.mock.calls[0][0]).toHaveLength(MAX_STREAM_BATCH);
    stream.close();
  });

  it("opens again after the socket closes, with a growing delay, and starts over once it is live", async () => {
    const { stream, onState, sockets } = setup();
    sockets[0].open();
    sockets[0].drop();
    expect(onState).toHaveBeenLastCalledWith("retrying", 1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets).toHaveLength(2);
    sockets[1].fail();
    expect(onState).toHaveBeenLastCalledWith("retrying", 2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(sockets).toHaveLength(3);
    sockets[2].open();
    expect(onState).toHaveBeenLastCalledWith("live");
    sockets[2].drop();
    expect(onState).toHaveBeenLastCalledWith("retrying", 1);
    stream.close();
  });

  it("counts one try for an error that is followed by a close", async () => {
    const { stream, sockets } = setup();
    sockets[0].fail();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets).toHaveLength(2);
    stream.close();
  });

  it("opens again at once on reconnect, and lets go of the old socket", () => {
    const { stream, sockets } = setup();
    sockets[0].open();
    stream.reconnect();
    expect(sockets[0].closed).toBe(true);
    expect(sockets).toHaveLength(2);
    stream.close();
  });

  it("stops for good when closed", async () => {
    const { stream, onMessages, onState, sockets } = setup();
    sockets[0].open();
    stream.close();
    expect(sockets[0].closed).toBe(true);
    expect(onState).toHaveBeenLastCalledWith("closed");
    sockets[0].send('{"late":true}');
    sockets[0].drop();
    await vi.advanceTimersByTimeAsync(STREAM_RETRY_MAX_MS * 2);
    expect(onMessages).not.toHaveBeenCalled();
    stream.reconnect();
    expect(sockets).toHaveLength(1);
  });
});
