import { z } from "zod";
import { textItem, webCitationItem, type ContentItem } from "../../lib/typed.ts";
import { describePage, fetchPage, MAX_PAGE_BYTES } from "../../../../src/lib/html-page.ts";
import { renderOverview } from "../../../../src/lib/page-text.ts";
import { getLogger } from "../../lib/logger.ts";
import { holdPage, pageIdFor } from "../../lib/page-store.ts";
import { scopeProblem, scopeSigSchema } from "../../lib/scope-check.ts";
import { urlProblem, urlSigSchema } from "../../lib/url-check.ts";

const logger = getLogger(["mcp", "fetch-webpage"]);

export { MAX_PAGE_BYTES };

export const fetchWebpageSchema = {
  url: z.string().url().describe("The URL to fetch"),
  "x-ines-url-sig": urlSigSchema,
  "x-ines-conversation-id": z
    .string()
    .optional()
    .describe("INTERNAL — populated by agent decoration. Do not set."),
  "x-ines-scope-sig": scopeSigSchema,
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** The chat to hold a page for: only one the agent signed (see scope-check.ts), and only when there is one. */
function chatToHold(args: { "x-ines-conversation-id"?: string; "x-ines-scope-sig"?: string }): string | null {
  if (scopeProblem(args) !== null) return null;
  return args["x-ines-conversation-id"] || null;
}

export async function fetchWebpageHandler(args: {
  url: string;
  "x-ines-url-sig"?: string;
  "x-ines-conversation-id"?: string;
  "x-ines-scope-sig"?: string;
}): Promise<{ content: ContentItem[] }> {
  const { url, "x-ines-url-sig": signature } = args;
  const problem = urlProblem(url, signature);
  if (problem) return { content: [textItem(problem)] };
  try {
    const { page, status } = await fetchPage(url);
    // Read in a process of its own: a page built to be slow to read cannot stop this server.
    const overview = await describePage(page, logger);
    const title = overview.title || hostOf(url);

    const chat = chatToHold(args);
    const id = await pageIdFor(url);
    const held =
      chat !== null &&
      holdPage(chat, {
        id,
        requestedUrl: url,
        url: page.url,
        title,
        contentType: page.contentType ?? "",
        source: page.html,
        markdown: overview.markdown,
        fetchedAt: Date.now(),
      });

    const text = renderOverview({
      url,
      title,
      status,
      contentType: page.contentType ?? "",
      bytes: page.html.length,
      overview,
      pageId: held ? id : null,
      more: held
        ? (shown) =>
            `This is an overview, not the whole page. Read on with inspect_webpage and this page_id: view "text" from offset ${shown}, "find" for a word or phrase, or take parts of the page with "select", "links", "tables", "data" or "raw".`
        : () => "This is the start of the page; it is not held, so the rest cannot be read from here.",
    });
    return { content: [textItem(text), webCitationItem({ url, title })] };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { content: [textItem(`Failed to fetch ${url}: ${msg}`)] };
  }
}

export const fetchWebpageDescription =
  "Fetch a web page and keep it. Returns an overview (title, outline, what the page contains, the start of its text) and a page_id, not the whole page: read the rest, or work on the page, with inspect_webpage.";
