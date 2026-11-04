import type { Citation, Widget } from "./types.ts";
import type { DocumentCitation, McpCitation } from "../mcp/results.ts";

export interface CitedWidget {
  widget: Widget;
  inputArgs: Record<string, unknown>;
  widgetUuid?: string;
}

export async function buildAllCitations(
  citedWidgets: Map<string, CitedWidget>,
  mcpCitations: McpCitation[],
  intermediateCitations: Citation[],
  widgets: Widget[] = [],
  answer?: string,
): Promise<Citation[]> {
  const widgetCits = citedWidgets.size > 0 ? await buildWidgetCitations(citedWidgets) : [];
  const documentCits = await buildDocumentCitations(
    selectCitedPages(
      mcpCitations.filter((c): c is DocumentCitation => c.type === "document"),
      answer,
    ),
    widgets,
  );
  const otherCits = buildMcpCitations(mcpCitations.filter((c) => c.type !== "document"));
  return preferCitationsWithPages(dedupeCitations([...intermediateCitations, ...widgetCits, ...documentCits, ...otherCits]));
}

export function pagesNamedIn(answer: string): Set<number> {
  const pages = new Set<number>();
  const reference = /\b(?:pages?|pp?\.?)[\s:]{0,20}(\d+(?:\s*(?:[-–—]|to)\s*\d+)?(?:\s*(?:,|&|and)\s*\d+(?:\s*(?:[-–—]|to)\s*\d+)?)*)/gi;
  for (const match of answer.matchAll(reference)) {
    for (const part of match[1].split(/\s*(?:,|&|and)\s*/i)) {
      const [from, to] = part.split(/\s*(?:[-–—]|to)\s*/i).map(Number);
      if (!Number.isFinite(from)) continue;
      const last = Number.isFinite(to) && to >= from && to - from < 50 ? to : from;
      for (let n = from; n <= last; n++) pages.add(n);
    }
  }
  return pages;
}

export const MAX_CITED_PAGES = 3;
export const CITED_SCORE_SHARE = 0.5;

export function selectCitedPages(hits: DocumentCitation[], answer?: string): DocumentCitation[] {
  const named = answer ? pagesNamedIn(answer) : new Set<number>();
  const byDocument = new Map<string, DocumentCitation[]>();
  for (const hit of hits) byDocument.set(hit.id, [...(byDocument.get(hit.id) ?? []), hit]);

  const selected: DocumentCitation[] = [];
  for (const docHits of byDocument.values()) {
    const ranked = [...docHits].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const asNamed = ranked.filter((h) => h.page != null && named.has(h.page));
    const best = ranked[0].score ?? 0;
    const chosen = asNamed.length > 0 ? asNamed : ranked.filter((h) => (h.score ?? best) >= best * CITED_SCORE_SHARE).slice(0, MAX_CITED_PAGES);
    const seen = new Set<number | undefined>();
    for (const h of chosen) {
      if (seen.has(h.page)) continue;
      seen.add(h.page);
      selected.push(h);
    }
  }
  return selected;
}

async function fileWidgetCitation(widget: Widget, widgetUuid: string, page?: number): Promise<Citation> {
  const ext = widget.metadata?.extension as string | undefined;
  const filename = (widget.metadata?.originalFileName as string | undefined) ?? widget.name;
  return {
    id: await citationUuid(widgetUuid, page != null ? { page } : {}),
    source_info: {
      type: "widget",
      uuid: widgetUuid,
      origin: widget.origin,
      widget_id: widget.widget_id,
      name: widget.name,
      description: widget.description,
      metadata: { input_args: {}, widget_uuid: widgetUuid },
      citable: true,
    },
    details: [{ Filename: filename, ...(ext ? { Extension: ext } : {}), ...(page != null ? { Page: page } : {}) }],
    signature: "",
  };
}

export async function buildDocumentCitations(
  documentCitations: DocumentCitation[],
  widgets: Widget[],
): Promise<Citation[]> {
  const out: Citation[] = [];
  for (const c of documentCitations) {
    const widget = widgets.find((w) => w.uuid === c.id);
    if (widget) out.push(await fileWidgetCitation(widget, c.id, c.page));
    else out.push(...buildMcpCitations([c]));
  }
  return out;
}

export function preferCitationsWithPages(citations: Citation[]): Citation[] {
  const fileOf = (c: Citation) => {
    const detail = c.details.find((d) => "Filename" in d);
    if (!detail) return null;
    const info = c.source_info as { uuid?: string | null; metadata?: { widget_uuid?: string } };
    return { key: info.metadata?.widget_uuid ?? info.uuid ?? String(detail.Filename), paged: detail.Page != null };
  };
  const paged = new Set(citations.flatMap((c) => (fileOf(c)?.paged ? [fileOf(c)!.key] : [])));
  return citations.filter((c) => {
    const file = fileOf(c);
    return !file || file.paged || !paged.has(file.key);
  });
}

export async function citationUuid(
  widgetUuid: string,
  inputArgs: Record<string, unknown>,
): Promise<string> {
  const sortedArgs = Object.keys(inputArgs)
    .sort()
    .reduce<Record<string, unknown>>((a, k) => {
      a[k] = inputArgs[k];
      return a;
    }, {});
  const canonical = JSON.stringify([widgetUuid, sortedArgs]);
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(canonical));
  const b = new Uint8Array(buf);
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export async function buildWidgetCitations(
  citedWidgets: Map<string, CitedWidget>,
): Promise<Citation[]> {
  const citations: Citation[] = [];
  for (const [mapKey, { widget, inputArgs, widgetUuid }] of citedWidgets) {
    const sourceWidgetUuid = widgetUuid ?? mapKey;
    const id = await citationUuid(sourceWidgetUuid, inputArgs);
    const filteredArgs: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(inputArgs)) {
      if (v != null && v !== "") filteredArgs[k] = v;
    }
    if (widget.widget_id.startsWith("file-")) {
      citations.push(await fileWidgetCitation(widget, sourceWidgetUuid));
      continue;
    }
    citations.push({
      id,
      source_info: {
        type: "widget",
        uuid: id,
        origin: widget.origin,
        widget_id: widget.widget_id,
        name: widget.name,
        description: widget.description,
        metadata: { input_args: filteredArgs, widget_uuid: sourceWidgetUuid },
        citable: true,
      },
      details: [{
        "Source type": "widget",
        Origin: widget.origin,
        "Data source": widget.name,
        ...filteredArgs,
      }],
      signature: "",
    });
  }
  return citations;
}

export function buildMcpCitations(mcpCitations: McpCitation[]): Citation[] {
  return mcpCitations.map((c) => {
    if (c.type === "web") {
      return {
        id: c.id,
        source_info: { type: "web" as const, name: c.title, citable: true as const },
        details: [{ link: c.url, title: c.title }],
        signature: "",
      };
    }
    return {
      id: c.id,
      source_info: { type: "file" as const, name: c.title, citable: true as const },
      details: [{ Filename: c.title, ...(c.page != null ? { Page: c.page } : {}) }],
      signature: "",
    };
  });
}

export function dedupeCitations(citations: Citation[]): Citation[] {
  const seen = new Map<string, Citation>();
  for (const c of citations) {
    let key: string;
    if (c.source_info.type === "widget") {
      const page = c.details.find((d) => "Filename" in d)?.Page;
      key = `widget|${c.source_info.metadata.widget_uuid}|${JSON.stringify(c.source_info.metadata.input_args)}|${page ?? ""}`;
    } else if (c.source_info.type === "file") {
      const filename = (c.details[0]?.Filename as string | undefined) ?? c.source_info.name;
      const page = c.details[0]?.Page;
      key = `file|${filename}|${page ?? ""}`;
    } else {
      key = `web|${(c.details[0]?.link as string | undefined) ?? c.id}`;
    }
    if (!seen.has(key)) seen.set(key, c);
  }
  return Array.from(seen.values());
}
