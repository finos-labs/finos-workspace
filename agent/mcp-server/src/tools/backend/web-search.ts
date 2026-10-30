import * as cheerio from "cheerio";
import { z } from "zod";
import { textItem, webCitationItem, type ContentItem } from "../../lib/typed.ts";

const SEARCH_URL = "https://html.duckduckgo.com/html/";
const USER_AGENT = "Mozilla/5.0 (compatible; Agent/1.0)";
const DEFAULT_RESULTS = 5;
const MAX_RESULTS = 20;

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export const webSearchSchema = {
  query: z.string().describe("The search query to find information on the web"),
  max_results: z
    .number()
    .optional()
    .default(DEFAULT_RESULTS)
    .describe(`Maximum number of results to return (default: ${DEFAULT_RESULTS}, max: ${MAX_RESULTS})`),
};

function resultUrl(href: string): string | null {
  let link: URL;
  try {
    link = new URL(href, "https://duckduckgo.com");
  } catch {
    return null;
  }
  const isDuckDuckGoHost = link.hostname === "duckduckgo.com" || link.hostname.endsWith(".duckduckgo.com");
  const target = isDuckDuckGoHost ? link.searchParams.get("uddg") : link.href;
  if (!target) return null;
  try {
    const { protocol } = new URL(target);
    return protocol === "https:" || protocol === "http:" ? target : null;
  } catch {
    return null;
  }
}

export function parseSearchResults(html: string, limit: number): SearchResult[] {
  const $ = cheerio.load(html);
  const results: SearchResult[] = [];
  $(".result").each((_, element) => {
    if (results.length >= limit) return false;
    const row = $(element);
    if (row.hasClass("result--ad")) return;
    const link = row.find("a.result__a").first();
    const url = resultUrl(link.attr("href") ?? "");
    const title = link.text().replace(/\s+/g, " ").trim();
    if (!url || !title) return;
    const snippet = row.find(".result__snippet").first().text().replace(/\s+/g, " ").trim();
    results.push({ title, url, snippet });
  });
  return results;
}

export async function webSearchHandler({
  query,
  max_results,
}: {
  query: string;
  max_results?: number;
}): Promise<{ content: ContentItem[] }> {
  const limit = Math.min(Math.max(Math.trunc(max_results ?? DEFAULT_RESULTS), 1), MAX_RESULTS);

  try {
    const response = await fetch(`${SEARCH_URL}?${new URLSearchParams({ q: query })}`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(15_000),
    });

    if (response.status === 202) {
      return {
        content: [textItem("DuckDuckGo asked for a human check and returned no results. Try again in a moment.")],
      };
    }
    if (!response.ok) {
      return { content: [textItem(`Search failed (${response.status}).`)] };
    }

    const results = parseSearchResults(await response.text(), limit);
    if (results.length === 0) {
      return { content: [textItem("No results found. Try a different query.")] };
    }

    const summaries = results.map((r) => `${r.title}\n${r.url}\n${r.snippet}`);
    return {
      content: [
        textItem(summaries.join("\n\n---\n\n")),
        ...results.map((r) => webCitationItem({ url: r.url, title: r.title })),
      ],
    };
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      return { content: [textItem("Web search timed out. Try a simpler query.")] };
    }
    throw err;
  }
}

export const webSearchDescription =
  "Search the web (DuckDuckGo) for current information. Use for recent events, news, live data not available in widgets, or factual lookups beyond your knowledge cutoff.";
