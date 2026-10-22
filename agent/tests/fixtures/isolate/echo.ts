import { serveOnce } from "../../../src/lib/isolate-child.ts";
await serveOnce((input: unknown) => ({ got: input }));
