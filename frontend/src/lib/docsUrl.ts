import { getConfig } from "./runtimeConfig";

export function docsUrl(path = ""): string | undefined {
  const base = getConfig().links.docsUrl.replace(/\/+$/, "");
  if (!base) return undefined;
  const page = path.replace(/^\/+/, "");
  return page ? `${base}/${page}` : base;
}
