/**
 * The pages that `fetch_webpage` has fetched, held for the chat that fetched them, so that
 * `inspect_webpage` can read parts of one without fetching it again (and without the page going through a
 * model whole).
 *
 * Filed under the chat's scope key, which names the user (src/lib/scope.ts), so a chat cannot read another
 * chat's page. Bounded in three ways: a few pages and a few megabytes to a chat, a ceiling on all chats
 * together (the least recently used go first), and a time (30 minutes). In memory, like the document store:
 * a restart drops them, and a page that is gone is fetched again.
 */

import { createBoundedCache, sweepEvery } from "../../../src/lib/bounded-cache";

export const PAGE_TTL_MS = 30 * 60 * 1000;
export const MAX_PAGES_PER_CHAT = 6;
/** Characters held for one chat (the source and the text of its pages). */
export const MAX_CHARS_PER_CHAT = 12_000_000;
/** Characters held for all chats together. */
export const MAX_CHARS_ALL_CHATS = 80_000_000;

export interface HeldPage {
  id: string;
  /** The address that was fetched. */
  requestedUrl: string;
  /** The address after redirects. */
  url: string;
  title: string;
  contentType: string;
  /** The page as fetched. */
  source: string;
  /** Its readable text, as markdown. */
  markdown: string;
  fetchedAt: number;
}

const weighPages = (pages: Map<string, HeldPage>): number => {
  let total = 0;
  for (const page of pages.values()) total += page.source.length + page.markdown.length;
  return total;
};

const chats = createBoundedCache<string, Map<string, HeldPage>>({
  ttlMs: PAGE_TTL_MS,
  maxEntries: 2000,
  weigh: weighPages,
  maxWeight: MAX_CHARS_ALL_CHATS,
  maxEntryWeight: MAX_CHARS_PER_CHAT,
});

sweepEvery(chats, 5 * 60 * 1000);

/** The same address is the same page: fetching it again replaces what was held. */
export async function pageIdFor(url: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(`page:${url}`));
  return `p-${Array.from(new Uint8Array(digest).slice(0, 4), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Holds a page for a chat; false when it is too large for a chat to hold. */
export function holdPage(scope: string, page: HeldPage): boolean {
  const pages = new Map(chats.get(scope) ?? []);
  pages.delete(page.id);
  pages.set(page.id, page);
  // The oldest go first, until what is left fits.
  while (pages.size > MAX_PAGES_PER_CHAT || (pages.size > 1 && weighPages(pages) > MAX_CHARS_PER_CHAT)) {
    const oldest = pages.keys().next().value as string;
    pages.delete(oldest);
  }
  if (weighPages(pages) > MAX_CHARS_PER_CHAT) return false;
  return chats.set(scope, pages);
}

export function getPage(scope: string, id: string): HeldPage | undefined {
  return chats.get(scope)?.get(id);
}

/** For tests. */
export function _resetPageStore(): void {
  chats.clear();
}
