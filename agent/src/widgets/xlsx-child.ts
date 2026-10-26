/** The child process that reads a spreadsheet (see lib/isolate.ts): a crafted file cannot take the agent with it. */

import { serveOnce } from "../lib/isolate-child.ts";
import { xlsxToJsonText } from "./xlsx.ts";

export interface XlsxChildInput {
  base64: string;
}

if (import.meta.main) {
  await serveOnce(async (input: XlsxChildInput) => xlsxToJsonText(Buffer.from(input.base64, "base64")));
}
