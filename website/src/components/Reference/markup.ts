export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "link"; text: string; href: string };

export type Block =
  | { kind: "paragraph"; inline: Inline[] }
  | { kind: "list"; ordered: boolean; items: Inline[][] }
  | { kind: "code"; text: string };

const INLINE = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBER = /^\s*\d+[.)]\s+(.*)$/;

export function parseInline(text: string): Inline[] {
  const parts: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) parts.push({ kind: "text", text: text.slice(last, match.index) });
    if (match[1] !== undefined) parts.push({ kind: "code", text: match[1] });
    else if (match[2] !== undefined) parts.push({ kind: "bold", text: match[2] });
    else parts.push({ kind: "link", text: match[3] as string, href: match[4] as string });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  return parts;
}

export function parseProse(text: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let fence: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", inline: parseInline(paragraph.join(" ")) });
    paragraph = [];
  };
  const flushList = () => {
    if (list !== null) blocks.push({ kind: "list", ordered: list.ordered, items: list.items.map(parseInline) });
    list = null;
  };

  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (fence !== null) {
      if (line.startsWith("```")) {
        blocks.push({ kind: "code", text: fence.join("\n") });
        fence = null;
      } else {
        fence.push(raw);
      }
      continue;
    }
    if (line.startsWith("```")) {
      flushParagraph();
      flushList();
      fence = [];
      continue;
    }
    if (line === "") {
      flushParagraph();
      flushList();
      continue;
    }
    const bullet = BULLET.exec(raw);
    const number = bullet === null ? NUMBER.exec(raw) : null;
    const marker = bullet ?? number;
    if (marker !== null) {
      flushParagraph();
      const ordered = number !== null;
      if (list !== null && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push(marker[1] as string);
      continue;
    }
    if (list !== null && /^\s/.test(raw)) {
      list.items[list.items.length - 1] += ` ${line}`;
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  if (fence !== null) blocks.push({ kind: "code", text: fence.join("\n") });
  flushParagraph();
  flushList();
  return blocks;
}
