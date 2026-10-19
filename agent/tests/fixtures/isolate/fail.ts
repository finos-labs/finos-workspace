import { serveOnce } from "../../../src/lib/isolate-child";
await serveOnce(() => {
  throw new Error("the work failed");
});
