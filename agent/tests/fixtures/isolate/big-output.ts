import { serveOnce } from "../../../src/lib/isolate-child.ts";
await serveOnce((input: { bytes: number }) => "x".repeat(input.bytes));
