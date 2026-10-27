import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import llms from "../plugins/llms.ts";

const SITE = "https://docs.example.test";

function page(body: string): string {
  return `<html><body><div class="theme-doc-markdown markdown"><header><h1>Page</h1></header>${body}</div></body></html>`;
}

async function describePage(html: string): Promise<string> {
  const outDir = await mkdtemp(join(tmpdir(), "llms-"));
  try {
    await writeFile(join(outDir, "page.html"), html);
    const doc = { id: "page", title: "Page", permalink: "/page", unlisted: false, frontMatter: {} };
    const content = { loadedVersions: [{ docs: [doc], sidebars: { docs: [{ type: "doc", id: "page" }] } }] };
    const siteConfig = {
      baseUrl: "/",
      url: SITE,
      title: "Site",
      tagline: "A tagline",
      themeConfig: { navbar: { items: [{ type: "docSidebar", sidebarId: "docs", label: "Docs" }] } },
    };
    const plugin = llms();
    await plugin.postBuild?.({ plugins: [{ name: "docusaurus-plugin-content-docs", content }], siteConfig, outDir } as never);
    const line = (await readFile(join(outDir, "llms.txt"), "utf8")).split("\n").find((entry) => entry.startsWith("- [Page]"));
    assert.ok(line, "llms.txt lists the page");
    return line.slice(`- [Page](${SITE}/page)`.length).replace(/^: /, "");
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}

test("describes a page by the first sentence of its first paragraph, with inline code kept", async () => {
  const description = await describePage(
    page('<p>The <a href="/x">file</a> is <code>agents.json</code>. It has more.</p><p>Another paragraph.</p>'),
  );
  assert.equal(description, "The file is `agents.json`.");
});

test("decodes the entities of the paragraph", async () => {
  const description = await describePage(page("<p>Fish &amp; chips, 2 &lt; 3, &quot;quoted&quot;&nbsp;text.</p>"));
  assert.equal(description, 'Fish & chips, 2 < 3, "quoted" text.');
});

test("leaves comments, scripts and styles out of the description", async () => {
  const description = await describePage(
    page("<p>Visible<!-- hidden --> text<script>alert(1)</script><style>p {}</style>.</p>"),
  );
  assert.equal(description, "Visible text.");
});

test("does not let split tags and comments turn into markup", async () => {
  const description = await describePage(page("<p>A <scr<script>ipt>x</script> b <!<!---->-- c</p>"));
  assert.doesNotMatch(description, /<[a-z!]/i);
});

test("gives a page without a first paragraph an empty description", async () => {
  const description = await describePage(page("<h2>No paragraph</h2>"));
  assert.equal(description, "");
});
