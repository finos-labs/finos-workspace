import { describe, it } from "node:test";
import { expect } from "expect";
import { scopeKey, signScope, verifyScope } from "../../../../src/lib/scope.ts";

const SECRET = "0123456789abcdef0123";

describe("scopeKey", () => {
  it("names the user as well as the chat", () => {
    expect(scopeKey("alice", "chat-1")).toBe("alice:chat-1");
    expect(scopeKey("bob", "chat-1")).not.toBe(scopeKey("alice", "chat-1"));
  });

  it("is empty for a request that names no chat", () => {
    expect(scopeKey("alice", "")).toBe("");
  });
});

describe("verifyScope", () => {
  it("accepts the signature of the same key and secret", () => {
    expect(verifyScope(SECRET, "alice:chat-1", signScope(SECRET, "alice:chat-1"))).toBe(true);
  });

  it("refuses another key, another secret, an empty signature and one of the wrong length", () => {
    const signature = signScope(SECRET, "alice:chat-1");
    expect(verifyScope(SECRET, "bob:chat-1", signature)).toBe(false);
    expect(verifyScope("another-secret-another-secret", "alice:chat-1", signature)).toBe(false);
    expect(verifyScope(SECRET, "alice:chat-1", "")).toBe(false);
    expect(verifyScope(SECRET, "alice:chat-1", signature.slice(0, -2))).toBe(false);
    expect(verifyScope(SECRET, "alice:chat-1", `${signature}00`)).toBe(false);
  });
});
