const UNRESOLVED_MENTION_PATTERN = /@\[id:[^\]\n]+\]/g;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const UNRESOLVED_MENTION_FALLBACK_LABEL = "@Unavailable";

function getTabSlug(token: string): string | null {
  const id = token.slice("@[id:".length, -1);
  return id.match(/(?:^|&)inner_tab=([^&]*)/)?.[1] || null;
}

function humanizeSlug(slug: string): string | null {
  if (UUID_PATTERN.test(slug)) return null;
  const words = slug.split(/[-_\s]+/).filter(Boolean);
  if (words.length === 0 || !/[a-z]/i.test(slug)) return null;
  return words.map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
}

export function getUnresolvedMentionLabel(token: string): string {
  const slug = getTabSlug(token);
  const name = slug ? humanizeSlug(slug) : null;
  return name ? `@${name}` : UNRESOLVED_MENTION_FALLBACK_LABEL;
}

export function findUnresolvedMentions(content: string): Map<string, string> {
  const tokens = content.match(UNRESOLVED_MENTION_PATTERN) || [];
  return new Map(
    tokens.map((token) => [token, getUnresolvedMentionLabel(token)] as const),
  );
}
