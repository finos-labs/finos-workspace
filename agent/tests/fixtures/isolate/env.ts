import { serveOnce } from "../../../src/lib/isolate-child";
await serveOnce(() => Object.keys(process.env));
