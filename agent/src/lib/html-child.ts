import { serveOnce } from "./isolate-child.ts";
import { overviewOf, viewOf, type ChildInput } from "./page-view.ts";

if (import.meta.main) {
  await serveOnce((input: ChildInput) =>
    input.op === "overview"
      ? overviewOf(input.html, input.url, input.contentType)
      : viewOf(input.html, input.url, input.request, input.contentType),
  );
}
