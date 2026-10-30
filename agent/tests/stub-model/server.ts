import { createServer } from "node:http";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

const PORT = Number(process.env.PORT ?? 11434);

export const STUB_ANSWER =
  "This answer came from the stubbed model that the end-to-end stack runs instead of a provider.";

function chunk(content: string, done: boolean) {
  return {
    model: "stub",
    created_at: new Date().toISOString(),
    done,
    message: { role: "assistant", content },
    ...(done
      ? {
          done_reason: "stop",
          prompt_eval_count: 1,
          eval_count: 1,
          total_duration: 1_000_000,
        }
      : {}),
  };
}

function whole(): Response {
  return Response.json(chunk(STUB_ANSWER, true));
}

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

  if (pathname === "/" || pathname === "/health") {
    return Response.json({ status: "ok", model: "stub" });
  }

  if (pathname.endsWith("/chat") || pathname.endsWith("/generate")) {
    let streaming = true;
    try {
      const body = (await request.json()) as { stream?: boolean };
      streaming = body.stream !== false;
    } catch {
    }
    return streaming ? streamed() : whole();
  }

  if (pathname.endsWith("/embed")) {
    return Response.json({ error: "This stub does not embed. Do not set AGENT_EMBED_MODEL with it." }, { status: 501 });
  }

  return new Response("Not found", { status: 404 });
}

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
