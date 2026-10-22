/**
 * A model that always says the same thing, so that the end-to-end tests can put a question through
 * the Copilot without a provider key.
 *
 * Ines registers the `ollama:` provider whether or not any credentials are set, and takes that
 * provider's address from OLLAMA_BASE_URL (src/lib/providers.ts). So a server that answers the two
 * requests the provider makes is a model as far as she is concerned: the end-to-end stack points her
 * at this one and asks it a question, and what is being tested is everything between the browser and
 * the model — sign-in, the user's limits, the agent loop, the text sink, the SSE protocol and the
 * chat — none of which should need a real model, money, or a network.
 *
 * It is not a fake of a model's judgement and must never grow into one: it answers one fixed
 * sentence, so a test that asserts on it is asserting that the answer arrived, not what it said.
 *
 * The wire protocol is Ollama's: `POST <base>/chat`, and with `stream: true` a line of JSON per
 * chunk (ollama-ai-provider-v2 splits on newlines). Every line carries the whole message shape the
 * provider validates, so a line that is missing `message` fails there rather than here.
 */

import { createServer } from "node:http";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

const PORT = Number(process.env.PORT ?? 11434);

/** What every answer says. The end-to-end test looks for this, so the two have to agree. */
export const STUB_ANSWER =
  "This answer came from the stubbed model that the end-to-end stack runs instead of a provider.";

/** The shape ollama-ai-provider-v2 validates every chunk against. */
function chunk(content: string, done: boolean) {
  return {
    model: "stub",
    created_at: new Date().toISOString(),
    done,
    message: { role: "assistant", content },
    ...(done
      ? {
          done_reason: "stop",
          // The agent reports these to the Workspace as the tokens a question used, so they are
          // numbers rather than nothing; they are not meant to be accurate.
          prompt_eval_count: 1,
          eval_count: 1,
          total_duration: 1_000_000,
        }
      : {}),
  };
}

/** The answer as one JSON body, for a caller that did not ask for a stream. */
function whole(): Response {
  return Response.json(chunk(STUB_ANSWER, true));
}

/** The answer as Ollama streams one: a line of JSON per chunk, the last with `done`. */
function streamed(): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const line = (value: unknown) => controller.enqueue(new TextEncoder().encode(`${JSON.stringify(value)}\n`));
      line(chunk(STUB_ANSWER, false));
      line(chunk("", true));
      controller.close();
    },
  });
  return new Response(body, { headers: { "content-type": "application/x-ndjson" } });
}

async function answer(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);

  // What the end-to-end job waits for before it starts the tests.
  if (pathname === "/" || pathname === "/health") {
    return Response.json({ status: "ok", model: "stub" });
  }

  // `/api/chat` is what the provider asks for a chat; `/api/generate` is the completion endpoint,
  // answered the same way so that a caller using it is not left hanging.
  if (pathname.endsWith("/chat") || pathname.endsWith("/generate")) {
    let streaming = true;
    try {
      const body = (await request.json()) as { stream?: boolean };
      streaming = body.stream !== false;
    } catch {
      // A body that is not JSON is still answered: the test is not about this server's strictness.
    }
    return streaming ? streamed() : whole();
  }

  // Embeddings would need a model that means something, and nothing in the end-to-end stack asks
  // for them (INES_EMBED_MODEL is not set). Say so rather than return a vector of zeros, which
  // would look like a working document search.
  if (pathname.endsWith("/embed")) {
    return Response.json({ error: "This stub does not embed. Do not set INES_EMBED_MODEL with it." }, { status: 501 });
  }

  return new Response("Not found", { status: 404 });
}

// No dependencies, so the bridge between Node's server and the Request/Response above is written out here.
createServer(async (incoming, outgoing) => {
  const hasBody = incoming.method !== "GET" && incoming.method !== "HEAD";
  const request = new Request(`http://localhost${incoming.url ?? "/"}`, {
    method: incoming.method,
    headers: incoming.headers as Record<string, string>,
    body: hasBody ? (Readable.toWeb(incoming) as ReadableStream<Uint8Array>) : undefined,
    duplex: "half",
  } as RequestInit);
  const response = await answer(request);
  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  if (response.body) Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>).pipe(outgoing);
  else outgoing.end();
}).listen(PORT, () => {
  console.log(`Stub model listening on ${PORT}: every question is answered "${STUB_ANSWER}"`);
});
