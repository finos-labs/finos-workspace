import { createRequire } from "node:module";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);

export type MermaidSvg = { ok: true; svg: string } | { ok: false; syntaxError: string };

interface MermaidGlobal {
  initialize(config: { startOnLoad: boolean }): void;
  render(id: string, source: string): Promise<{ svg: string }>;
}

/**
 * Renders Mermaid source to SVG. Mermaid measures text in a real DOM, so its own browser bundle runs
 * in a headless Chromium page. Every render gets a fresh browser, so renders cannot affect each other,
 * and the browser is always closed, including when the render times out.
 *
 * A syntax error in the diagram comes back as a value; a failure to launch the browser or a timeout
 * throws.
 */
export async function renderMermaidSvg(source: string, timeoutMs: number): Promise<MermaidSvg> {
  const browser = await chromium.launch();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const page = await browser.newPage();
    await page.setContent("<!doctype html><html><body></body></html>");
    await page.addScriptTag({ path: require.resolve("mermaid/dist/mermaid.min.js") });
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`render timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    const rendered = page.evaluate(async (diagram: string): Promise<MermaidSvg> => {
      const mermaid = (globalThis as unknown as { mermaid: MermaidGlobal }).mermaid;
      mermaid.initialize({ startOnLoad: false });
      try {
        const { svg } = await mermaid.render("ines-diagram", diagram);
        return { ok: true, svg };
      } catch (err) {
        return { ok: false, syntaxError: err instanceof Error ? err.message : String(err) };
      }
    }, source);
    return await Promise.race([rendered, timeout]);
  } finally {
    clearTimeout(timer);
    await browser.close();
  }
}
