import DOMPurify, { type Config as DOMPurifyConfig } from "dompurify";

export const HTML_SANITIZE_CONFIG: DOMPurifyConfig = {
  FORBID_TAGS: ["script", "iframe", "form", "object", "embed"],
  FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover"],
  ALLOW_DATA_ATTR: false,
};

export const MARKDOWN_SANITIZE_CONFIG: DOMPurifyConfig = {
  ALLOWED_TAGS: [
    "p",
    "br",
    "strong",
    "em",
    "u",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "ul",
    "ol",
    "li",
    "blockquote",
    "code",
    "pre",
    "a",
  ],
  ALLOWED_ATTR: ["href", "target", "rel"],
};

export function sanitizeMarkdown(markdown: string): string {
  if (!markdown) return markdown;

  const codeBlocks: string[] = [];
  const token = Math.random().toString(36).substring(2, 15);

  const processed = markdown.replace(/(```[\s\S]*?```)/g, (match) => {
    codeBlocks.push(match);
    return `__CODE_BLOCK_${token}_${codeBlocks.length - 1}__`;
  });

  let sanitized = DOMPurify.sanitize(processed, MARKDOWN_SANITIZE_CONFIG);

  codeBlocks.forEach((block, i) => {
    sanitized = sanitized.replace(`__CODE_BLOCK_${token}_${i}__`, () => block);
  });

  return sanitized;
}
