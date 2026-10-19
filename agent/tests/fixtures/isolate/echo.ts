import { serveOnce } from "../../../src/lib/isolate-child";
await serveOnce((input: unknown) => ({ got: input }));
