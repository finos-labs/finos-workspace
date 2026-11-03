import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { LoadedContent } from "@docusaurus/plugin-content-docs";
import type { Plugin } from "@docusaurus/types";
import { type DefaultTreeAdapterMap, parse } from "parse5";

const DOCS_PLUGIN = "docusaurus-plugin-content-docs";
const FILE_NAME = "llms.txt";
const ABBREVIATION = /\b(?:e\.g|i\.e|etc|vs)\.$/i;

type Version = LoadedContent["loadedVersions"][number];
type SidebarItem = Version["sidebars"][string][number];
type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
type TextNode = DefaultTreeAdapterMap["textNode"];

interface NavbarSidebar {
  sidebarId: string;
  label: string;
}

interface Entry {
  id: string;
  title: string;
  url: string;
  description: string;
}

interface Section {
  title: string;
  entries: Entry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDocsContent(value: unknown): value is LoadedContent {
  return isRecord(value) && Array.isArray(value.loadedVersions) && value.loadedVersions.length > 0;
}

function navbarSidebars(themeConfig: Record<string, unknown>): NavbarSidebar[] {
  const navbar = themeConfig.navbar;
  const items = isRecord(navbar) && Array.isArray(navbar.items) ? navbar.items : [];
  return items.flatMap((item) =>
    isRecord(item) && item.type === "docSidebar" && typeof item.sidebarId === "string" && typeof item.label === "string"
      ? [{ sidebarId: item.sidebarId, label: item.label }]
      : [],
  );
}

function isElement(node: Node): node is Element {
  return "tagName" in node;
}

function isText(node: Node): node is TextNode {
  return node.nodeName === "#text";
}

function childrenOf(node: Node): Node[] {
  return "childNodes" in node ? node.childNodes : [];
}

function classesOf(element: Element): string[] {
  return (element.attrs.find((attribute) => attribute.name === "class")?.value ?? "").split(/\s+/);
}

function findElement(node: Node, matches: (element: Element) => boolean): Element | undefined {
  for (const child of childrenOf(node)) {
    if (isElement(child) && matches(child)) return child;
    const found = findElement(child, matches);
    if (found) return found;
  }
  return undefined;
}

function textOf(node: Node): string {
  if (isText(node)) return node.value;
  if (!isElement(node) || node.tagName === "script" || node.tagName === "style") return "";
  const text = childrenOf(node).map(textOf).join("");
  return node.tagName === "code" ? `\`${text}\`` : text;
}

function firstParagraphText(html: string): string {
  const page = findElement(parse(html), (element) => {
    const classes = classesOf(element);
    return element.tagName === "div" && classes.includes("theme-doc-markdown") && classes.includes("markdown");
  });
  const [header, paragraph] = page?.childNodes.filter(isElement) ?? [];
  if (header?.tagName !== "header" || paragraph?.tagName !== "p") return "";
  return textOf(paragraph).replace(/\s+/g, " ").trim();
}

function firstSentence(text: string): string {
  let inCode = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === "`") {
      inCode = !inCode;
    } else if (
      !inCode &&
      ".!?".includes(character) &&
      (index === text.length - 1 || /\s/.test(text[index + 1])) &&
      !ABBREVIATION.test(text.slice(0, index + 1))
    ) {
      return text.slice(0, index + 1);
    }
  }
  return text;
}

function pageFile(permalink: string, baseUrl: string): string {
  const path = permalink.slice(baseUrl.length);
  return path === "" ? "index.html" : `${path}.html`;
}

function renderLink({ title, url, description }: Entry): string {
  const label = title.replace(/\s+/g, " ").trim().replace(/[[\]]/g, (character) => `\\${character}`);
  return description ? `[${label}](${url}): ${description}` : `[${label}](${url})`;
}

function renderSection({ title, entries }: Section): string {
  return [`## ${title}`, "", ...entries.map((entry) => `- ${renderLink(entry)}`), ""].join("\n");
}

function sectionsOf(version: Version, sidebars: NavbarSidebar[], entryOf: (id: string) => Entry): Section[] {
  const sections: Section[] = [];

  function walk(items: SidebarItem[], path: string[], lead: string[]): void {
    const section: Section = { title: path.join(": "), entries: lead.map(entryOf) };
    sections.push(section);
    for (const item of items) {
      if (item.type === "doc") section.entries.push(entryOf(item.id));
    }
    for (const item of items) {
      if (item.type === "category") walk(item.items, [...path, item.label], item.link?.type === "doc" ? [item.link.id] : []);
    }
  }

  for (const { sidebarId, label } of sidebars) {
    const sidebar = version.sidebars[sidebarId];
    if (!sidebar) throw new Error(`llms.txt: the navbar names the sidebar ${sidebarId}, which does not exist`);
    walk(sidebar, [label], []);
  }
  return sections.filter((section) => section.entries.length > 0);
}

export default function llms(): Plugin {
  return {
    name: "llms-txt",
    async postBuild({ plugins, siteConfig, outDir }) {
      const content = plugins.find((plugin) => plugin.name === DOCS_PLUGIN)?.content;
      if (!isDocsContent(content)) throw new Error(`llms.txt: the plugin ${DOCS_PLUGIN} loaded no docs`);
      const [version] = content.loadedVersions;
      const docs = new Map(version.docs.map((doc) => [doc.id, doc]));

      const descriptions = new Map<string, string>();
      for (const doc of version.docs) {
        const written = doc.frontMatter.description;
        if (typeof written === "string") {
          descriptions.set(doc.id, written.replace(/\s+/g, " ").trim());
          continue;
        }
        const html = await readFile(join(outDir, pageFile(doc.permalink, siteConfig.baseUrl)), "utf8");
        descriptions.set(doc.id, firstSentence(firstParagraphText(html)));
      }

      const entryOf = (id: string): Entry => {
        const doc = docs.get(id);
        if (!doc) throw new Error(`llms.txt: a sidebar names the doc ${id}, which does not exist`);
        return { id, title: doc.title, url: new URL(doc.permalink, siteConfig.url).href, description: descriptions.get(id) ?? "" };
      };
      const sections = sectionsOf(version, navbarSidebars(siteConfig.themeConfig), entryOf);

      const listed = sections.flatMap((section) => section.entries.map((entry) => entry.id));
      const twice = listed.filter((id, index) => listed.indexOf(id) !== index);
      if (twice.length > 0) throw new Error(`llms.txt: these pages are listed twice: ${twice.join(", ")}`);
      const home = version.docs.find((doc) => doc.permalink === siteConfig.baseUrl);
      const missing = version.docs
        .filter((doc) => !doc.unlisted && doc !== home && !listed.includes(doc.id))
        .map((doc) => doc.id);
      if (missing.length > 0) throw new Error(`llms.txt: these pages are in no sidebar: ${missing.join(", ")}`);

      const intro = home && !listed.includes(home.id) ? [renderLink(entryOf(home.id)), ""] : [];
      const text = [`# ${siteConfig.title}`, "", `> ${siteConfig.tagline}`, "", ...intro, ...sections.map(renderSection)].join("\n");
      await writeFile(join(outDir, FILE_NAME), text);
    },
  };
}
