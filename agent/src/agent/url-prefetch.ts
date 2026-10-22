/**
 * Eager URL prefetch.
 *
 * Workspace extracts URLs from the user's message (linkify-it, cap 4) and
 * forwards them in `request.urls`. The loop fetches them server-side before
 * the first model call and gives the model an OVERVIEW of each page (what it
 * is, what it contains, the start of its text), not the page: a model that
 * needs more calls `fetch_webpage` and reads the part it needs with
 * `inspect_webpage`. Each prefetch also produces a web citation that flows
 * through the normal citation aggregator.
 *
 * Failures are logged and silently dropped — a single bad URL must not block
 * the entire request. `Promise.allSettled` + a per-URL timeout keeps the total
 * added latency bounded by the slowest URL (not the sum).
 */

import { getLogger } from "../lib/logger.ts";
import { describePage, fetchPage } from "../lib/html-page.ts";
import { renderOverview } from "../lib/page-text.ts";

const logger = getLogger(["app", "agent", "url-prefetch"]);

const MAX_URLS = 4;

export interface UrlPrefetchResult {
  url: string;
  title: string;
  /** What the model is given of the page: see `renderOverview`. */
  overview: string;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

async function fetchOne(url: string): Promise<UrlPrefetchResult> {
  const { page, status } = await fetchPage(url);
  // The page is the user's link, and may be made to be slow to read: that is done in a process of its own.
  const overview = await describePage(page, logger);
  const title = overview.title || hostOf(url);
  return {
    url,
    title,
    overview: renderOverview({
      url,
      title,
      status,
      contentType: page.contentType ?? "",
      bytes: page.html.length,
      overview,
      pageId: null,
      more: () =>
        "This is an overview of the page, not the whole page. To read more of it or search it, call fetch_webpage with this address, then inspect_webpage with the page_id it returns.",
    }),
  };
}

export async function prefetchUrls(
  urls: string[] | undefined,
): Promise<UrlPrefetchResult[]> {
  if (!urls || urls.length === 0) return [];
  const sliced = urls.slice(0, MAX_URLS);
  const settled = await Promise.allSettled(sliced.map((u) => fetchOne(u)));
  const out: UrlPrefetchResult[] = [];
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r.status === "fulfilled") {
      out.push(r.value);
    } else {
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      logger.warn(`URL prefetch failed for ${sliced[i]}: ${msg}`);
    }
  }
  if (out.length > 0) {
    logger.info("URL prefetch done", { requested: sliced.length, ok: out.length });
  }
  return out;
}

/** Stable citation id derived from the URL, so re-fetching the same URL
 * dedupes through the existing citation aggregator. */
export async function urlCitationId(url: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(`url:${url}`));
  const b = new Uint8Array(buf);
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
