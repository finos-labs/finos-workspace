import { writeFileSync } from "node:fs";
import { serveOnce } from "../../../src/lib/isolate-child.ts";
await serveOnce((input: { pidFile: string }) => {
  writeFileSync(input.pidFile, String(process.pid));
  while (true) {
    /* never ends */
  }
});
