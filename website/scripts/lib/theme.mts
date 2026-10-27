import { readFileSync } from "node:fs";
import type { PluginToken, ReportColour, ReportData, ReportGroup } from "../../src/data/types.ts";
import type { ParsedCss } from "./css.mts";
import { fromRepo } from "./paths.mts";

const PLUGIN_THEME_FILE = "frontend/src/plugins/theme.ts";
const REPORT_FILE = "agent/src/skills/html-report.md";

export function collectPluginTokens(css: ParsedCss): PluginToken[] {
  const source = readFileSync(fromRepo(PLUGIN_THEME_FILE), "utf8");
  const list = /const TOKENS = \[([\s\S]*?)\] as const;/.exec(source);
  if (list === null) throw new Error("No TOKENS list in plugins/theme.ts");
  const declared = new Map(css.tokenFiles.flatMap((file) => file.tokens).map((token) => [token.name, token]));
  return Array.from((list[1] as string).matchAll(/"([\w-]+)"/g)).map((match) => {
    const property = `--${match[1]}`;
    const token = declared.get(property);
    const entry: PluginToken = { name: match[1] as string, property };
    entry.light = token?.lightColor ?? token?.light;
    entry.dark = token?.darkColor ?? token?.dark ?? entry.light;
    return entry;
  });
}

function plain(text: string): string {
  return text.replace(/\*\*/g, "").replace(/`/g, "").replace(/\s+/g, " ").trim();
}

function section(markdown: string, heading: string): string[] {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`## ${heading}`));
  if (start === -1) throw new Error(`No section ${heading} in the report skill`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return end === -1 ? rest : rest.slice(0, end);
}

export function collectReport(): ReportData {
  const markdown = readFileSync(fromRepo(REPORT_FILE), "utf8");

  const groups: ReportGroup[] = [];
  for (const line of section(markdown, "PAGE COMPONENT LIBRARY")) {
    if (line.startsWith("### ")) {
      groups.push({ title: line.slice(4).trim(), items: [] });
      continue;
    }
    if (!line.startsWith("- ") || groups.length === 0) continue;
    const text = line.slice(2).trim();
    const separator = text.indexOf(" -- ");
    const left = separator === -1 ? text : text.slice(0, separator);
    const classes = text.startsWith("`") ? Array.from(left.matchAll(/`([^`]+)`/g)).map((match) => match[1] as string) : [];
    const description = text.startsWith("`") && separator !== -1 ? plain(text.slice(separator + 4)) : plain(text.replace(" -- ", ": "));
    groups[groups.length - 1]?.items.push({ classes, description });
  }

  const colours: ReportColour[] = [];
  for (const line of section(markdown, "COLOR REFERENCE")) {
    if (!line.startsWith("|") || /^\|[-\s|]+\|$/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => plain(cell));
    if (cells[0] === "Element") continue;
    colours.push({ element: cells[0] as string, colour: cells[1] as string, hex: cells[2] as string });
  }
  return { groups, colours };
}
