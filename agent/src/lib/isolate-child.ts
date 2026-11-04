import { text } from "node:stream/consumers";
import { RESULT_MARKER } from "./isolate-protocol.ts";

export async function serveOnce<I, O>(handler: (input: I) => Promise<O> | O): Promise<never> {
  let line: string;
  try {
    const input = JSON.parse(await text(process.stdin)) as I;
    line = JSON.stringify({ ok: true, value: await handler(input) });
  } catch (error) {
    line = JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
  await new Promise<void>((resolve) => process.stdout.write(`${RESULT_MARKER}${line}`, () => resolve()));
  process.exit(0);
}
