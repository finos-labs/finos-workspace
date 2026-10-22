/**
 * The child process that reads a web page (see isolate.ts): a page built to be slow, deep or wide to parse
 * cannot stop the agent or the tool server. Run through `describePage` and `viewPage` (html-page.ts).
 */

import { serveOnce } from "./isolate-child.ts";
import { overviewOf, viewOf, type ChildInput } from "./page-view.ts";

if (import.meta.main) {
  await serveOnce((input: ChildInput) =>
    input.op === "overview"
      ? overviewOf(input.html, input.url, input.contentType)
      : viewOf(input.html, input.url, input.request, input.contentType),
  );
}
