import { createBoundedCache, sweepEvery } from "../../../src/lib/bounded-cache.ts";

const PAGE_TTL_MS = 30 * 60 * 1000;
const MAX_PAGES_PER_CHAT = 6;
const MAX_CHARS_PER_CHAT = 12_000_000;
const MAX_CHARS_ALL_CHATS = 80_000_000;

export interface HeldPage {
  id: string;
  requestedUrl: string;
  url: string;
  title: string;
  contentType: string;
  source: string;
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

export async function pageIdFor(url: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(`page:${url}`));
  return `p-${Array.from(new Uint8Array(digest).slice(0, 4), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function holdPage(scope: string, page: HeldPage): boolean {
  const pages = new Map(chats.get(scope) ?? []);
  pages.delete(page.id);
  pages.set(page.id, page);
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

export function _resetPageStore(): void {
  chats.clear();
}
