import { serveOnce } from "../../../src/lib/isolate-child.ts";
console.log("a log line the work printed");
process.stdout.write("@@ not a result @@");
await serveOnce(() => "the answer");
