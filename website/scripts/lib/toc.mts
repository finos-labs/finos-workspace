import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export function lacksToc(html: string): boolean {
  const article = html.match(/<article[\s\S]*<\/article>/)?.[0] ?? "";
  return /<h[23][^>]* id="[^"]+"/.test(article) && !html.includes("theme-doc-toc-desktop");
}

function pages(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return name === "assets" ? [] : pages(path);
    return name.endsWith(".html") ? [path] : [];
  });
}

export function pagesWithoutToc(build: string): string[] {
  return pages(build)
    .filter((page) => lacksToc(readFileSync(page, "utf8")))
    .map((page) => page.slice(build.length));
}
