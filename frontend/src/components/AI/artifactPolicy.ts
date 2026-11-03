export const ARTIFACT_BASE_STYLE =
  "<style>body{margin:0;padding:0}table{display:block;overflow-x:auto;max-width:100%}</style>";

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

export function artifactNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

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
