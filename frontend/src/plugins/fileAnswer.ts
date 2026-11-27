export interface FileAnswer {
  file: { name: string; mime: string; base64: string };
}

const UNSAFE_NAME = /[^\p{L}\p{N}_.\- ()]+/gu;
const MAX_NAME_LENGTH = 200;
const MAX_MIME_LENGTH = 100;

function decoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return "";
  }
}

export function fileNameOf(disposition: string | null, url: string): string {
  const header = (disposition ?? "").slice(0, 1024);
  const star = /filename\*\s*=\s*(?:utf-8)?''([^;]+)/i.exec(header)?.[1];
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header)?.[1];
  let name = (star && decoded(star.trim())) || plain?.trim() || "";
  if (!name) {
    try {
      name = decoded(new URL(url, "http://localhost").pathname.split("/").pop() ?? "");
    } catch {
      name = "";
    }
  }
  const clean = name
    .replace(/^.*[\\/]/, "")
    .replace(UNSAFE_NAME, "_")
    .slice(0, MAX_NAME_LENGTH)
    .trim();
  return clean || "file";
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk)
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

export async function fileAnswerOf(
  response: Response,
  url: string,
): Promise<FileAnswer> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const mime = (response.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .slice(0, MAX_MIME_LENGTH);
  return {
    file: {
      name: fileNameOf(response.headers.get("content-disposition"), url),
      mime: mime || "application/octet-stream",
      base64: toBase64(bytes),
    },
  };
}
