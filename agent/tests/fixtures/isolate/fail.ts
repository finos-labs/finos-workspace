import { serveOnce } from "../../../src/lib/isolate-child.ts";
await serveOnce(() => {
  throw new Error("the work failed");
});
