import type { WrapperProps } from "@docusaurus/types";
import TOC from "@theme-original/TOC";
import type TOCType from "@theme/TOC";
import { useEffect, useRef, useState } from "react";

type Props = WrapperProps<typeof TOCType>;
type Item = Props["toc"][number];

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderedHeadings(min: number, max: number): Item[] {
  const selector = Array.from({ length: max - min + 1 }, (_, index) => `.theme-doc-markdown h${min + index}[id]`).join(",");
  return Array.from(document.querySelectorAll<HTMLHeadingElement>(selector)).map((heading) => ({
    id: heading.id,
    level: Number(heading.tagName.slice(1)),
    value: escape(
      Array.from(heading.childNodes)
        .filter((node) => !(node instanceof HTMLAnchorElement && node.classList.contains("hash-link")))
        .map((node) => node.textContent ?? "")
        .join(" ")
        .replace(/​/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    ),
  }));
}

export default function TOCWrapper(props: Props) {
  const [toc, setToc] = useState(props.toc);
  const container = useRef<HTMLDivElement>(null);
  const min = props.minHeadingLevel ?? 2;
  const max = props.maxHeadingLevel ?? 3;
  useEffect(() => {
    const found = renderedHeadings(min, max);
    setToc(found.length > props.toc.length ? found : props.toc);
  }, [props.toc, min, max]);
  useEffect(() => {
    for (const link of container.current?.querySelectorAll<HTMLAnchorElement>(".table-of-contents__link") ?? []) {
      link.title = link.textContent ?? "";
    }
  }, [toc]);
  return (
    <div ref={container} style={{ display: "contents" }}>
      <TOC {...props} toc={toc} />
    </div>
  );
}
