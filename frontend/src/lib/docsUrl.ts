import { getConfig } from "./runtimeConfig";

/**
 * A page of the documentation, `path` being relative to the documentation site that
 * `links.docsUrl` names. Undefined when the deployment has none: the link is left out.
 */
export function docsUrl(path = ""): string | undefined {
  const base = getConfig().links.docsUrl.replace(/\/+$/, "");
  if (!base) return undefined;
  const page = path.replace(/^\/+/, "");
  return page ? `${base}/${page}` : base;
}
