import { serveOnce } from "../../../src/lib/isolate-child";
await serveOnce((input: { bytes: number }) => "x".repeat(input.bytes));
