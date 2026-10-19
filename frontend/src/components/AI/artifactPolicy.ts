/**
 * What an HTML artifact may load. An artifact is HTML that a model wrote (a report, a table, a chart), shown in
 * the chat in an iframe. It is sanitized, but a style, an image or a font that points at a server is a request
 * made by the user's browser to that server, with whatever the model put in the address, and nobody clicked
 * anything. So the document carries a policy of its own that allows nothing from the network: the inline styles
 * and the images and fonts written into the document as `data:` are what an artifact is made of, and they work;
 * everything else (an image, a stylesheet, a font, a frame, a request, a form) is refused by the browser.
 */

/** The `Content-Security-Policy` of an artifact document. `scriptNonce` is for the script the app adds itself. */
export function artifactContentSecurityPolicy(scriptNonce?: string): string {
  return [
    "default-src 'none'",
    "img-src data:",
    "style-src 'unsafe-inline'",
    "font-src data:",
    scriptNonce ? `script-src 'nonce-${scriptNonce}'` : null,
    "form-action 'none'",
    "base-uri 'none'",
  ]
    .filter(Boolean)
    .join("; ");
}

/** A value for one document: not guessable by the content of the artifact, which is written before it exists. */
export function artifactNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The document with the policy as the first thing in it, and `extra` (the app's own style and script) at the
 * end of its head. The policy goes first because it governs what comes after it.
 */
export function withArtifactPolicy(
  html: string,
  policy: string,
  extra: string,
): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
  const open = /<head\b[^>]*>/i.exec(html);
  let out = html;
  if (open) {
    const at = open.index + open[0].length;
    out = `${html.slice(0, at)}${meta}${html.slice(at)}`;
    return out.includes("</head>")
      ? out.replace("</head>", `${extra}</head>`)
      : `${out.slice(0, at + meta.length)}${extra}${out.slice(at + meta.length)}`;
  }
  return `${meta}${extra}${html}`;
}
