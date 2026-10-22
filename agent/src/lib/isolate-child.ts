/**
 * The other end of isolate.ts: what a script that runs in a child process calls.
 *
 *   await serveOnce(async (input) => doTheWork(input));
 *
 * It reads the JSON input from stdin, runs the handler, writes the JSON result and exits. An error of the
 * handler is the result (`ok: false`), not a crash.
 */

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
  // A write to a pipe is not done until the callback says so: exiting before it would cut a large answer short.
  await new Promise<void>((resolve) => process.stdout.write(`${RESULT_MARKER}${line}`, () => resolve()));
  process.exit(0);
}
