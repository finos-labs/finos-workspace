/**
 * The scope of a chat: whose chat it is. Everything the agent and the MCP tools keep for a chat (the
 * rows of its widgets, its documents, its code sandbox) is filed under the chat's scope key, which
 * names the user as well as the chat, so one user's chat can never be another's.
 *
 * The browser, not the agent, makes the MCP calls and so carries the scope key to the tools, which
 * means that a user could put any scope key in a call. The agent therefore signs each scope key with
 * a secret that only it and the tools know, and the tools accept only a signed one.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** The key everything of one chat is filed under; "" when the request names no chat. */
export function scopeKey(userId: string, conversationId: string): string {
  return conversationId ? `${userId}:${conversationId}` : "";
}

/** The user a scope key belongs to (see scopeKey); a key that names no user is its own owner. */
export function userOfScope(key: string): string {
  const at = key.indexOf(":");
  return at === -1 ? key : key.slice(0, at);
}

export function signScope(secret: string, key: string): string {
  return createHmac("sha256", secret).update(key).digest("hex");
}

export function verifyScope(secret: string, key: string, signature: string): boolean {
  const expected = Buffer.from(signScope(secret, key), "utf8");
  const given = Buffer.from(signature, "utf8");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The signature of an address the agent allows a tool to fetch (see src/agent/known-urls.ts). */
export function signUrl(secret: string, url: string): string {
  return signScope(secret, `fetch:${url}`);
}

export function verifyUrl(secret: string, url: string, signature: string): boolean {
  return verifyScope(secret, `fetch:${url}`, signature);
}
