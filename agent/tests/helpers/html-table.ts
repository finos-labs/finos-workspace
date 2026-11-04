function unescapeHtml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

export function tableRows(artifact: unknown): Record<string, string>[] {
  const html = String((artifact as { content?: unknown })?.content ?? "");
  const headers = [...html.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => unescapeHtml(m[1]));
  const body = html.match(/<tbody>([\s\S]*)<\/tbody>/)?.[1] ?? "";
  return [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((tr) => {
    const cells = [...tr[1].matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((m) => unescapeHtml(m[1]));
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ""]));
  });
}

export function asCells(rows: Record<string, unknown>[]): Record<string, string>[] {
  return rows.map((r) =>
    Object.fromEntries(
      Object.entries(r).map(([k, v]) => [
        k,
        v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v),
      ]),
    ),
  );
}
