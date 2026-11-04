import { serveOnce } from "../../../src/lib/isolate-child.ts";
await serveOnce(() => Object.keys(process.env));
