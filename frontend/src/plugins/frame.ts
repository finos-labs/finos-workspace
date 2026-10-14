import { serialize } from "./csp";
import type { ColorScheme } from "./protocol";
import shellSource from "./shell/shell.js?raw";

/**
 * The document of a plugin frame (docs/widget-plugins/SECURITY.md 4.6): a `srcdoc` whose
 * first element is the policy, then the shell, whose hash is in that policy. The iframe
 * carries `sandbox="allow-scripts"` and nothing else, so the document has an opaque
 * origin.
 */

export const FRAME_SANDBOX = "allow-scripts";

let shellHashPromise: Promise<string> | null = null;

/** `sha256-<base64>` of the shell script, as CSP hash sources write it. */
export function shellHash(): Promise<string> {
  shellHashPromise ??= crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(shellSource))
    .then((digest) => {
      let binary = "";
      for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
      return `sha256-${btoa(binary)}`;
    });
  return shellHashPromise;
}

function escapeAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Which policy checks the canary runs: each must produce a violation event. */
export function canaryProbes(effective: Record<string, string[]>): string[] {
  const probes = ["connect", "img", "inline"];
  if (!(effective["script-src"] ?? []).includes("'unsafe-eval'")) probes.push("eval");
  return probes;
}

export async function buildSrcdoc(
  effective: Record<string, string[]>,
  scheme: ColorScheme,
): Promise<string> {
  const policy = serialize(effective, await shellHash());
  const config = escapeAttribute(JSON.stringify({ probes: canaryProbes(effective) }));
  return [
    `<!doctype html><html data-ws="${config}"><head>`,
    `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(policy)}">`,
    '<meta http-equiv="x-dns-prefetch-control" content="off">',
    '<meta name="referrer" content="no-referrer">',
    `<meta name="color-scheme" content="${scheme === "light" ? "light" : "dark"}">`,
    '<meta charset="utf-8">',
    "<style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}</style>",
    '</head><body><div id="root"></div>',
    `<script>${shellSource}</script>`,
    "</body></html>",
  ].join("");
}
