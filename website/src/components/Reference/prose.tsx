import type { ReactNode } from "react";
import { type Inline, parseInline, parseProse } from "./markup";
import styles from "./styles.module.css";

function inline(parts: Inline[]): ReactNode[] {
  return parts.map((part, index) => {
    if (part.kind === "code") return <code key={index}>{part.text}</code>;
    if (part.kind === "bold") return <strong key={index}>{part.text}</strong>;
    if (part.kind === "link") {
      return (
        <a key={index} href={part.href}>
          {part.text}
        </a>
      );
    }
    return part.text;
  });
}

export function InlineText({ text }: { text: string }) {
  return <>{inline(parseInline(text))}</>;
}

export function Prose({ text }: { text: string }) {
  const blocks = parseProse(text);
  if (blocks.length === 0) return null;
  return (
    <div className={styles.prose}>
      {blocks.map((block, index) => {
        if (block.kind === "paragraph") return <p key={index}>{inline(block.inline)}</p>;
        if (block.kind === "code") {
          return (
            <pre key={index}>
              <code>{block.text}</code>
            </pre>
          );
        }
        const List = block.ordered ? "ol" : "ul";
        return (
          <List key={index}>
            {block.items.map((item, position) => (
              <li key={position}>{inline(item)}</li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
