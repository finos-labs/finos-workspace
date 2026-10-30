/*
 * `{field}` templates and the small Markdown a hover card shows: headings, paragraphs, lists,
 * **bold**, *italic*, `code` and [links](url) shown as text. Everything is built with DOM nodes
 * and textContent, so a backend's text never becomes markup.
 */

/** Replaces each `{name}` with the first of `sources` that has it; unknown names stay as they are. */
export function fillTemplate(template, ...sources) {
  return String(template ?? "").replace(/\{([\w.$-]+)\}/g, (whole, path) => {
    for (const source of sources) {
      const value = lookup(source, path);
      if (value !== undefined) return value === null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
    }
    return whole;
  });
}

function lookup(source, path) {
  if (!source || typeof source !== "object") return undefined;
  if (Object.hasOwn(source, path)) return source[path];
  let value = source;
  for (const part of path.split(".")) {
    if (!value || typeof value !== "object" || !Object.hasOwn(value, part)) return undefined;
    value = value[part];
  }
  return value;
}

const INLINE = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\))/;

function appendInline(doc, parent, text) {
  let rest = text;
  while (rest) {
    const match = INLINE.exec(rest);
    if (!match) { parent.appendChild(doc.createTextNode(rest)); return; }
    if (match.index > 0) parent.appendChild(doc.createTextNode(rest.slice(0, match.index)));
    const [, , bold1, bold2, em1, em2, code, linkText] = match;
    let node;
    if (bold1 !== undefined || bold2 !== undefined) { node = doc.createElement("strong"); appendInline(doc, node, bold1 ?? bold2); }
    else if (em1 !== undefined || em2 !== undefined) { node = doc.createElement("em"); appendInline(doc, node, em1 ?? em2); }
    else if (code !== undefined) { node = doc.createElement("code"); node.textContent = code; }
    else { node = doc.createElement("span"); node.className = "ag-table-chart-md-link"; node.textContent = linkText; }
    parent.appendChild(node);
    rest = rest.slice(match.index + match[0].length);
  }
}

/** Renders Markdown into a new element of `doc`. */
export function renderMarkdown(doc, markdown) {
  const root = doc.createElement("div");
  root.className = "ag-table-chart-md";
  let list = null;
  let paragraph = null;
  const close = () => { list = null; paragraph = null; };

  for (const raw of String(markdown ?? "").split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) { close(); continue; }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      close();
      const node = doc.createElement(`h${Math.min(heading[1].length + 2, 6)}`);
      appendInline(doc, node, heading[2]);
      root.appendChild(node);
      continue;
    }
    const item = /^\s*(?:[-*+]|(\d+)[.)])\s+(.*)$/.exec(line);
    if (item) {
      paragraph = null;
      const ordered = item[1] !== undefined;
      if (!list || (list.tagName === "OL") !== ordered) {
        list = doc.createElement(ordered ? "ol" : "ul");
        root.appendChild(list);
      }
      const li = doc.createElement("li");
      appendInline(doc, li, item[2]);
      list.appendChild(li);
      continue;
    }
    list = null;
    if (!paragraph) {
      paragraph = doc.createElement("p");
      root.appendChild(paragraph);
    } else {
      paragraph.appendChild(doc.createElement("br"));
    }
    appendInline(doc, paragraph, line);
  }
  return root;
}
