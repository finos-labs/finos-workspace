import { createHash } from "node:crypto";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { JSONValue, LanguageModel } from "ai";
import { createOllama } from "ollama-ai-provider-v2";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { withInlineToolCalls } from "./inline-tool-calls.ts";
import { getLogger } from "./logger.ts";

interface ProviderEntry {
  prefix: string;
  resolve: (modelId: string) => LanguageModel;
}

const providers: ProviderEntry[] = [];

export const PROVIDER_OPTIONS: Record<string, Record<string, JSONValue>> = {
  openai: { store: false, include: ["reasoning.encrypted_content"] },
};

export function providerOptionsFor(
  conversationId: string | undefined,
): Record<string, Record<string, JSONValue>> {
  if (!conversationId) return PROVIDER_OPTIONS;
  return {
    ...PROVIDER_OPTIONS,
    openai: { ...PROVIDER_OPTIONS.openai, promptCacheKey: promptCacheKey(conversationId) },
  };
}

export function promptCacheKey(conversationId: string): string {
  return createHash("sha256").update(conversationId).digest("base64url");
}


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
  if (process.env.AGENT_INLINE_TOOL_CALLS === "off" || typeof model === "string") return model;
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
