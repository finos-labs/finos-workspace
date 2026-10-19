/**
 * What the agent and the tool server do with a web page that someone else wrote: describe it, and read parts
 * of it (page-view.ts). The DOM work is done so that a page made to be slow cannot hold up the process.
 */

import type { Logger } from "@logtape/logtape";
import { runInChild } from "./isolate";
import { fetchClientUrl } from "./safe-fetch";
import type { ChildInput, PageOverview, PageRequest, PageViewResult } from "./page-view";

export type { PageOverview, PageRequest, PageViewResult };

/** The largest page that is read: what a web page is (a few hundred KB) with room to spare. */
export const MAX_PAGE_BYTES = 5 * 1024 * 1024;
const CHILD_TIMEOUT_MS = 10_000;
const CHILD = new URL("./html-child.ts", import.meta.url).pathname;

export interface FetchedPage {
  html: string;
  /** Where the page is after redirects: what its relative links are relative to. */
  url: string;
  contentType?: string;
}

/** What a page is and what it contains, with its readable text. */
export function describePage(page: FetchedPage, logger: Logger): Promise<PageOverview> {
  const input: ChildInput = { op: "overview", html: page.html, url: page.url, contentType: page.contentType };
  return runInChild<ChildInput, PageOverview>(CHILD, input, { timeoutMs: CHILD_TIMEOUT_MS, label: "page read", logger });
}

/** One view of a page that needs its DOM. */
export function viewPage(page: FetchedPage, request: PageRequest, logger: Logger): Promise<PageViewResult> {
  const input: ChildInput = { op: "view", html: page.html, url: page.url, contentType: page.contentType, request };
  return runInChild<ChildInput, PageViewResult>(CHILD, input, { timeoutMs: CHILD_TIMEOUT_MS, label: "page read", logger });
}

/** What can be read as a page: markup, text, or JSON. A PDF, an image or a download is not one. */
const READABLE_TYPE = /^(text\/|application\/(xhtml\+xml|xml|json|ld\+json)$|[^/]+\/[^/;]+\+(xml|json)$)/;

export async function fetchPage(url: string): Promise<{ page: FetchedPage; status: number }> {
  const res = await fetchClientUrl(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; InesAgent/1.0)",
      Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,application/json;q=0.8,*/*;q=0.5",
    },
    signal: AbortSignal.timeout(10_000),
    maxBytes: MAX_PAGE_BYTES,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (contentType && !READABLE_TYPE.test(contentType)) {
    void res.body?.cancel();
    throw new Error(`That address is ${contentType}, which is not a web page.`);
  }
  const html = await res.text();
  return { page: { html, url: res.url || url, contentType }, status: res.status };
}
