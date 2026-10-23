import { z } from "zod";
import { errorItem, sqliteTableItem, textItem, type ContentItem } from "../../lib/typed.ts";
import { viewPage, type FetchedPage } from "../../../../src/lib/html-page.ts";
import { findInText, readText } from "../../../../src/lib/page-text.ts";
import { getLogger } from "../../lib/logger.ts";
import { getPage, type HeldPage } from "../../lib/page-store.ts";
import { scopeSigSchema } from "../../lib/scope-check.ts";

const logger = getLogger(["mcp", "inspect-webpage"]);

const VIEWS = ["text", "find", "select", "links", "tables", "data", "raw"] as const;

const DEFAULT_CHARS = 6000;
const MAX_CHARS = 12_000;

export const inspectWebpageSchema = {
  page_id: z.string().describe("The page_id that fetch_webpage returned."),
  view: z
    .enum(VIEWS)
    .describe(
      "text: the page's readable text from an offset. find: where a word or phrase occurs, with the text around it and its offset. " +
        "select: the elements that a CSS selector names. links: the page's links. tables: its HTML tables (loaded as tables you can query with SQL). " +
        "data: JSON that the page embeds (JSON-LD, framework data), as a list, or one part by path. raw: the page's HTML source, from an offset or around a phrase.",
    ),
  selector: z
    .string()
    .optional()
    .describe("A CSS selector. For select, the elements to show; for text, find, links and tables, the part of the page to read."),
  query: z
    .string()
    .optional()
    .describe("find and raw: the word or phrase to look for (not a pattern). links: only the links whose text or address contains it."),
  path: z.string().optional().describe("data: a path into one source, such as 0.props.items.2. Leave it out to list the sources."),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Where to start: a character for text and raw, an item (match, element, link, table) for the other views."),
  limit: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(`How much: characters for text, raw and data (default ${DEFAULT_CHARS}, at most ${MAX_CHARS}), items for the other views.`),
  "x-ines-conversation-id": z
    .string()
    .optional()
    .describe("INTERNAL — populated by agent decoration. Do not set."),
  "x-ines-scope-sig": scopeSigSchema,
};

export const inspectWebpageDescription =
  "Read parts of a page that fetch_webpage fetched, by its page_id, without fetching it again and without taking the whole page: " +
  "its text from an offset, where a phrase occurs, elements by CSS selector, links, tables, embedded JSON, or its HTML source. " +
  "Every view returns a bounded amount; use offset and limit to go on.";

type Args = z.infer<z.ZodObject<typeof inspectWebpageSchema>>;

const clampChars = (limit: number | undefined, fallback = DEFAULT_CHARS): number => Math.min(limit ?? fallback, MAX_CHARS);
const clampItems = (limit: number | undefined, fallback: number, max: number): number => Math.min(limit ?? fallback, max);

function asFetched(page: HeldPage): FetchedPage {
  return { html: page.source, url: page.url, contentType: page.contentType };
}

function findView(text: string, args: Args, where: string): string {
  const query = args.query?.trim();
  if (!query) return "Say what to look for (query).";
  const { total, counted, matches } = findInText(text, query, { skip: args.offset ?? 0, max: clampItems(args.limit, 8, 20) });
  if (total === 0) return `Nothing in ${where} contains that.`;
  if (matches.length === 0) return `${counted} matches in ${where}, none from ${(args.offset ?? 0) + 1}.`;
  const first = (args.offset ?? 0) + 1;
  return [
    `Matches ${first}–${first + matches.length - 1} of ${counted}, with their offsets in ${where}:`,
    ...matches.map((m) => `[at ${m.at}] ${m.snippet}`),
  ].join("\n");
}

function tableItems(result: { text: string; tables?: Array<{ name: string; rows: Record<string, string>[] }> }): ContentItem[] {
  return [textItem(result.text), ...(result.tables ?? []).map((t) => sqliteTableItem(t.name, t.rows))];
}

export async function inspectWebpageHandler(args: Args): Promise<{ content: ContentItem[] }> {
  const chat = args["x-ines-conversation-id"];
  const page = chat ? getPage(chat, args.page_id) : undefined;
  if (!page) {
    return {
      content: [
        textItem(
          "That page is not held (a page is kept for 30 minutes, six to a chat). Fetch it again with fetch_webpage, which returns a page_id.",
        ),
      ],
    };
  }

  try {
    switch (args.view) {
      case "text": {
        if (!args.selector) return { content: [textItem(readText(page.markdown, args.offset ?? 0, clampChars(args.limit)))] };
        const region = await viewPage(asFetched(page), { view: "region", selector: args.selector }, logger);
        return { content: [textItem(region.markdown !== undefined ? readText(region.markdown, args.offset ?? 0, clampChars(args.limit)) : region.text)] };
      }

      case "find": {
        if (!args.selector) return { content: [textItem(findView(page.markdown, args, "the text"))] };
        const region = await viewPage(asFetched(page), { view: "region", selector: args.selector }, logger);
        return { content: [textItem(region.markdown !== undefined ? findView(region.markdown, args, "that part of the page") : region.text)] };
      }

      case "raw": {
        if (args.query?.trim()) return { content: [textItem(findView(page.source, args, "the source"))] };
        return { content: [textItem(readText(page.source, args.offset ?? 0, clampChars(args.limit, 4000)))] };
      }

      case "select": {
        if (!args.selector) return { content: [textItem("Give a CSS selector (selector).")] };
        const result = await viewPage(
          asFetched(page),
          { view: "select", selector: args.selector, offset: args.offset ?? 0, limit: clampItems(args.limit, 20, 50) },
          logger,
        );
        return { content: [textItem(result.text)] };
      }

      case "links": {
        const result = await viewPage(
          asFetched(page),
          { view: "links", selector: args.selector, query: args.query, offset: args.offset ?? 0, limit: clampItems(args.limit, 40, 100) },
          logger,
        );
        return { content: [textItem(result.text)] };
      }

      case "tables": {
        const result = await viewPage(
          asFetched(page),
          { view: "tables", selector: args.selector, offset: args.offset ?? 0, limit: clampItems(args.limit, 3, 5), name: `web_${page.id.replace(/-/g, "")}` },
          logger,
        );
        const note = result.tables?.length ? "\nThese are loaded as tables: query them with execute_sql." : "";
        return { content: tableItems({ ...result, text: result.text + note }) };
      }

      case "data": {
        const result = await viewPage(asFetched(page), { view: "data", path: args.path, limit: clampChars(args.limit) }, logger);
        return { content: [textItem(result.text)] };
      }
    }
  } catch (e) {
    logger.warn("inspect_webpage failed: {error}", { error: e instanceof Error ? e.message : String(e) });
    return {
      content: [errorItem({ code: "PAGE_READ_FAILED", message: "The page could not be read that way (it may be too large or too deeply built).", retryable: false })],
    };
  }
}
