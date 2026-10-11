import { serveOnce } from "../../../src/lib/isolate-child";
await serveOnce(async (input: { ms: number }) => {
  const start = Date.now();
  await Bun.sleep(input.ms);
  return { start, end: Date.now() };
});
