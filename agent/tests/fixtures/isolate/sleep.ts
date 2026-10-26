import { setTimeout as sleep } from "node:timers/promises";
import { serveOnce } from "../../../src/lib/isolate-child.ts";
await serveOnce(async (input: { ms: number }) => {
  const start = Date.now();
  await sleep(input.ms);
  return { start, end: Date.now() };
});
