import { describe, it } from "node:test";
import { expect } from "expect";
import { PROVIDER_OPTIONS, promptCacheKey, providerOptionsFor } from "../../../../src/lib/providers.ts";

describe("providerOptionsFor", () => {
  // OpenAI routes requests to machines holding a matching prefix; without a
  // stable prompt_cache_key that routing is effectively random, so a shared
  // prefix only caches by luck. Measured before this existed: identical
  // back-to-back requests hit 99%, but ANY variation (even just a different
  // user message) dropped to 0% cached.
  it("sets promptCacheKey so a chat's requests route to the same machine", () => {
    const out = providerOptionsFor("chat-abc");
    expect(out.openai?.promptCacheKey).toBe(promptCacheKey("chat-abc"));
    expect(providerOptionsFor("chat-abc").openai?.promptCacheKey).toBe(out.openai!.promptCacheKey!);
  });

  it("keeps the key within OpenAI's 64 characters for a scope key of two UUIDs", () => {
    // A conversation id is "<user id>:<chat id>" (lib/scope.ts): 73 characters,
    // which OpenAI rejects as a prompt_cache_key.
    const conversationId = `${crypto.randomUUID()}:${crypto.randomUUID()}`;
    expect(conversationId.length).toBe(73);
    const key = providerOptionsFor(conversationId).openai?.promptCacheKey as string;
    expect(key.length).toBeLessThanOrEqual(64);
    expect(key).not.toContain(conversationId.split(":")[0]!);
    expect(promptCacheKey("x".repeat(10_000)).length).toBeLessThanOrEqual(64);
  });

  it("gives different chats different keys", () => {
    expect(promptCacheKey("user-1:chat-1")).not.toBe(promptCacheKey("user-1:chat-2"));
    expect(promptCacheKey("user-1:chat-1")).not.toBe(promptCacheKey("user-2:chat-1"));
  });

  it("preserves the existing provider options", () => {
    const out = providerOptionsFor("chat-abc");
    expect(out.openai?.store).toBe(PROVIDER_OPTIONS.openai!.store!);
    expect(out.openai?.include).toEqual(PROVIDER_OPTIONS.openai!.include!);
  });

  it("omits the key when there is no conversation id", () => {
    // Better no key than a constant one shared by every chat, which would
    // funnel unrelated traffic onto one machine.
    expect(providerOptionsFor(undefined).openai?.promptCacheKey).toBeUndefined();
    expect(providerOptionsFor("").openai?.promptCacheKey).toBeUndefined();
  });

  it("does not mutate the shared PROVIDER_OPTIONS constant", () => {
    providerOptionsFor("chat-xyz");
    expect(PROVIDER_OPTIONS.openai?.promptCacheKey).toBeUndefined();
  });
});
