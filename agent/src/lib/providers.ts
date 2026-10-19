import { createHash } from "node:crypto";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { JSONValue, LanguageModel } from "ai";
import { createOllama } from "ollama-ai-provider-v2";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { withInlineToolCalls } from "./inline-tool-calls";
import { getLogger } from "./logger";

interface ProviderEntry {
  prefix: string;
  resolve: (modelId: string) => LanguageModel;
}

const providers: ProviderEntry[] = [];

/**
 * Provider options sent with every model call.
 *
 * OpenAI's Responses API stores reasoning items server-side and lets a
 * follow-up request cite them by id. This harness rebuilds the whole message
 * list on each turn and never sends `previousResponseId`, so that storage buys
 * nothing — and it breaks outright for Zero Data Retention organizations,
 * where the items are discarded immediately and the next tool round-trip fails
 * with "Item with id 'rs_...' not found". Opting out of storage and carrying
 * the reasoning inline as encrypted content keeps multi-step tool turns
 * working on every account type. Non-OpenAI providers ignore this key.
 */
export const PROVIDER_OPTIONS: Record<string, Record<string, JSONValue>> = {
  openai: { store: false, include: ["reasoning.encrypted_content"] },
};

/**
 * Per-request provider options carrying a prompt cache key.
 *
 * OpenAI serves prompt caching from whichever machine recently handled a
 * matching prefix, and routes requests there by `prompt_cache_key`. Without
 * one, routing is effectively arbitrary, so a shared prefix only caches by
 * luck — measured on this agent: identical back-to-back requests cached 99%,
 * while any variation at all (even just a different user message) cached 0%.
 *
 * Keyed on `conversationId`, which pins one chat's requests to one machine.
 * That is where the win is: a single turn round-trips several times over the
 * same ~8k-token system-prompt-plus-tools prefix. It deliberately gives up
 * cross-chat reuse — a coarser key would share more prefixes but OpenAI asks
 * that traffic per key stay near 15 req/min, which a per-chat key can't breach.
 */
export function providerOptionsFor(
  conversationId: string | undefined,
): Record<string, Record<string, JSONValue>> {
  if (!conversationId) return PROVIDER_OPTIONS;
  return {
    ...PROVIDER_OPTIONS,
    openai: { ...PROVIDER_OPTIONS.openai, promptCacheKey: promptCacheKey(conversationId) },
  };
}

/**
 * The prompt cache key of a chat. OpenAI rejects a `prompt_cache_key` longer
 * than 64 characters, and a conversation id is the chat's scope key,
 * "<user id>:<chat id>" (see lib/scope.ts), 73 characters for two UUIDs and
 * longer for a longer X-Trace-Id. So the key is a SHA-256 hash of it, 43
 * characters of base64url: the same chat always gets the same key, and the
 * user's id does not go to the provider.
 */
export function promptCacheKey(conversationId: string): string {
  return createHash("sha256").update(conversationId).digest("base64url");
}

// No model id is written anywhere in this code. A provider is registered when
// its credentials are present; which model to use is DEFAULT_MODEL, written
// "<provider>:<model>" with <model> being whatever that provider calls it.

const openaiKey = process.env.OPENAI_API_KEY;
if (openaiKey) {
  const openai = createOpenAI({ apiKey: openaiKey });
  providers.push({ prefix: "openai", resolve: (id) => openai(id) });
}

const openrouterKey = process.env.OPENROUTER_API_KEY;
if (openrouterKey) {
  const openrouter = createOpenRouter({ apiKey: openrouterKey });
  providers.push({ prefix: "openrouter", resolve: (id) => openrouter(id) });
}

const groqKey = process.env.GROQ_API_KEY;
if (groqKey) {
  const groq = createGroq({ apiKey: groqKey });
  providers.push({ prefix: "groq", resolve: (id) => groq(id) });
}

// NVIDIA NIM serves an OpenAI-compatible Chat Completions API, so the OpenAI
// client is reused with a different base URL. `.chat()` selects Chat
// Completions; the default `nvidia(id)` call would use the Responses API,
// which NIM does not implement.
const nvidiaKey = process.env.NVIDIA_API_KEY;
if (nvidiaKey) {
  const nvidia = createOpenAI({
    apiKey: nvidiaKey,
    baseURL: "https://integrate.api.nvidia.com/v1",
  });
  providers.push({ prefix: "nvidia", resolve: (id) => nvidia.chat(id) });
}

const ollama = createOllama({
  baseURL: process.env.OLLAMA_BASE_URL || "http://localhost:11434/api",
});
providers.push({ prefix: "ollama", resolve: (id) => ollama(id) });

function providerFor(rawModelId: string): ProviderEntry | undefined {
  return providers.find((p) => rawModelId.startsWith(`${p.prefix}:`));
}

export function resolveModel(rawModelId: string): LanguageModel {
  const provider = providerFor(rawModelId);
  if (!provider) {
    const known = providers.map((p) => `${p.prefix}:`).join(", ");
    throw new Error(
      `No provider for model "${rawModelId}". A model id is "<provider>:<model>" and the ` +
        `provider needs its credentials (registered prefixes: ${known}).`,
    );
  }
  const model = provider.resolve(rawModelId.slice(provider.prefix.length + 1));
  // A model that calls a tool by writing a marker in its text (see inline-tool-calls.ts) works like any other.
  // INES_INLINE_TOOL_CALLS=off turns the reading of its text off.
  if (process.env.INES_INLINE_TOOL_CALLS === "off" || typeof model === "string") return model;
  return withInlineToolCalls(model as LanguageModelV3);
}

const logger = getLogger(["app", "providers"]);

if (providers.length === 0) {
  logger.error("No AI providers configured. Set at least one API key (OPENAI_API_KEY, OPENROUTER_API_KEY, GROQ_API_KEY, NVIDIA_API_KEY) or use Ollama.");
}
if (!process.env.DEFAULT_MODEL) {
  logger.warn("DEFAULT_MODEL is not set; a request that does not pick a model will fail until it is.");
}
const available = providers.map((p) => p.prefix).join(", ");
logger.info("Providers available", { providers: available });
