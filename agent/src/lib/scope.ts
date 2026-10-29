import { createHmac, timingSafeEqual } from "node:crypto";

export function scopeKey(userId: string, conversationId: string): string {
  return conversationId ? `${userId}:${conversationId}` : "";
}

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

export function signUrl(secret: string, url: string): string {
  return signScope(secret, `fetch:${url}`);
}

export function verifyUrl(secret: string, url: string, signature: string): boolean {
  return verifyScope(secret, `fetch:${url}`, signature);
}
