import { describe, it, beforeEach, afterEach } from "node:test";
import { expect } from "expect";
import { fn } from "jest-mock";
import {
  embedChunks,
  embeddingProblem,
  getEmbeddingModel,
  retrieve,
  _resetEmbeddingModel,
} from "../../../../../../mcp-server/src/tools/backend/documents/retrieve.ts";
import {
  upsertDocument,
  _resetDocStoreState,
} from "../../../../../../mcp-server/src/tools/backend/documents/store.ts";

const realFetch = globalThis.fetch;
const KEYS = ["AGENT_EMBED_MODEL", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "NVIDIA_API_KEY", "OLLAMA_BASE_URL"];
const savedEnv: Record<string, string | undefined> = {};

interface Request {
  url: string;
  authorization: string | null;
  body: { model: string; input: string[]; input_type?: string; truncate?: string };
}

function recordRequests(): Request[] {
  const seen: Request[] = [];
  globalThis.fetch = fn(async (input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    seen.push({
      url: String(input),
      authorization: new Headers(init?.headers).get("authorization"),
      body,
    });
    return new Response(
      JSON.stringify({
        object: "list",
        model: body.model,
        data: body.input.map((_: string, index: number) => ({ object: "embedding", index, embedding: [1, 0, 0] })),
        usage: { prompt_tokens: 1, total_tokens: 1 },
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }) as unknown as typeof fetch;
  return seen;
}

const chunk = (i: number) => ({ id: `d:${i}`, docId: "d", index: i, text: `text ${i}`, tokens: 2 });

beforeEach(() => {
  for (const k of KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  _resetEmbeddingModel();
  _resetDocStoreState();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  _resetEmbeddingModel();
});

describe("embeddingProblem", () => {
  it("asks for AGENT_EMBED_MODEL when it is unset", () => {
    expect(embeddingProblem()).toContain("AGENT_EMBED_MODEL is not set");
  });

  it("rejects a value that names no provider", () => {
    process.env.AGENT_EMBED_MODEL = "some-bare-model";
    expect(embeddingProblem()).toContain("must be <provider>:<model>");
  });

  it("rejects a provider that cannot embed", () => {
    process.env.AGENT_EMBED_MODEL = "groq:anything";
    expect(embeddingProblem()).toContain("must be <provider>:<model>");
  });

  it("names the credential a provider is missing", () => {
    process.env.AGENT_EMBED_MODEL = "nvidia:some/model";
    expect(embeddingProblem()).toContain("NVIDIA_API_KEY");
    process.env.AGENT_EMBED_MODEL = "openai:some-model";
    expect(embeddingProblem()).toContain("OPENAI_API_KEY");
    process.env.AGENT_EMBED_MODEL = "openrouter:some/model";
    expect(embeddingProblem()).toContain("OPENROUTER_API_KEY");
  });

  it("is satisfied by a provider with its credential, and by Ollama without one", () => {
    process.env.AGENT_EMBED_MODEL = "nvidia:some/model";
    process.env.NVIDIA_API_KEY = "k";
    expect(embeddingProblem()).toBeNull();
    process.env.AGENT_EMBED_MODEL = "ollama:some-model:latest";
    expect(embeddingProblem()).toBeNull();
  });

  it("makes getEmbeddingModel throw the same explanation", () => {
    process.env.AGENT_EMBED_MODEL = "nvidia:some/model";
    expect(() => getEmbeddingModel("passage")).toThrow("NVIDIA_API_KEY");
  });
});

describe("NVIDIA embeddings", () => {
  beforeEach(() => {
    process.env.AGENT_EMBED_MODEL = "nvidia:nvidia/some-embed-model";
    process.env.NVIDIA_API_KEY = "test-key";
  });

  it("sends stored text as passages to NVIDIA's endpoint with the model after the prefix", async () => {
    const seen = recordRequests();
    const vectors = await embedChunks([chunk(0), chunk(1)]);
    expect(vectors).toEqual([[1, 0, 0], [1, 0, 0]]);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("https://integrate.api.nvidia.com/v1/embeddings");
    expect(seen[0].authorization).toBe("Bearer test-key");
    expect(seen[0].body).toMatchObject({
      model: "nvidia/some-embed-model",
      input: ["text 0", "text 1"],
      input_type: "passage",
      truncate: "END",
    });
  });

  it("sends the question as a query", async () => {
    const seen = recordRequests();
    await upsertDocument("c1", {
      id: "d",
      name: "d.pdf",
      format: "pdf",
      chunks: [{ ...chunk(0), page: 2 }],
      embeddings: [[1, 0, 0]],
      ingestedAt: 0,
    });
    const hits = await retrieve("c1", "what is the budget?", { topK: 3 });
    expect(seen).toHaveLength(1);
    expect(seen[0].body).toMatchObject({ input: ["what is the budget?"], input_type: "query" });
    expect(hits[0].chunk.page).toBe(2);
  });

  it("stays within NVIDIA's 256 inputs per request and keeps the vectors aligned", async () => {
    const seen = recordRequests();
    const vectors = await embedChunks(Array.from({ length: 600 }, (_, i) => chunk(i)));
    expect(seen.map((r) => r.body.input.length)).toEqual([256, 256, 88]);
    expect(seen[2].body.input[0]).toBe("text 512");
    expect(vectors).toHaveLength(600);
  });
});

describe("other providers", () => {
  it("sends OpenAI's own request without NVIDIA's fields", async () => {
    process.env.AGENT_EMBED_MODEL = "openai:some-embed-model";
    process.env.OPENAI_API_KEY = "oa-key";
    const seen = recordRequests();
    await embedChunks([chunk(0)]);
    expect(seen[0].url).toBe("https://api.openai.com/v1/embeddings");
    expect(seen[0].authorization).toBe("Bearer oa-key");
    expect(seen[0].body.model).toBe("some-embed-model");
    expect(seen[0].body.input_type).toBeUndefined();
    expect(seen[0].body.truncate).toBeUndefined();
  });

  it("resolves an OpenRouter model", () => {
    process.env.AGENT_EMBED_MODEL = "openrouter:vendor/some-embed-model";
    process.env.OPENROUTER_API_KEY = "or-key";
    const model = getEmbeddingModel("passage");
    expect(model).toMatchObject({ specificationVersion: "v3", modelId: "vendor/some-embed-model" });
  });

  it("resolves an Ollama model whose name contains a colon", () => {
    process.env.AGENT_EMBED_MODEL = "ollama:some-embed-model:latest";
    const model = getEmbeddingModel("passage");
    expect(model).toMatchObject({ specificationVersion: "v3", modelId: "some-embed-model:latest" });
  });
});
