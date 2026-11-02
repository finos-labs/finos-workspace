import { fileURLToPath } from "node:url";
import { pagesWithoutToc } from "./lib/toc.mts";

const missing = pagesWithoutToc(fileURLToPath(new URL("../build", import.meta.url)));
if (missing.length > 0) {
  console.error(`These pages have headings and no table of contents. A page needs one heading of its own in its Markdown, because the table of contents is drawn only for a page whose Markdown has headings:\n${missing.join("\n")}`);
  process.exit(1);
}
