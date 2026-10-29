export const HTTP_URL_RE = /^https?:\/\/.+/i;

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const SAFE_PROTOCOLS = new Set(["http:", "https:"]);

export function safeExternalUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return SAFE_PROTOCOLS.has(new URL(url).protocol) ? url : null;
  } catch {
    return null;
  }
}

export function openExternalUrl(url: string | null | undefined): void {
  const safe = safeExternalUrl(url);
  if (safe) window.open(safe, "_blank", "noopener,noreferrer");
}
