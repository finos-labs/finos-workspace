import isEqual from "lodash.isequal";
import { fetchCopilotAccess, putApiSourceMcpServers } from "~/api/auth.api";
import { type Source, useBackendConnectorStore } from "./backendConnector";
import { normalizeMcpUrl, useCopilotAccessStore } from "./copilotAccess";

const MAX_SERVERS = 100;
const MAX_URL_LENGTH = 400;

function isServerUrl(url: string) {
  try {
    const { protocol, username, password } = new URL(url);
    return (protocol === "http:" || protocol === "https:") && !username && !password;
  } catch {
    return false;
  }
}

export function declaredMcpServers(source: Source): string[] {
  const declared = [
    ...Object.values(source.widgets ?? {}).map((widget) => widget.storage?.mcpUrl),
    ...(source.templates ?? []).flatMap((template) =>
      (template.mcpServers ?? []).map((server) => server.url),
    ),
  ];
  const urls = declared
    .filter((url): url is string => typeof url === "string" && isServerUrl(url.trim()))
    .map(normalizeMcpUrl)
    .filter((url) => url.length <= MAX_URL_LENGTH);
  return [...new Set(urls)].sort().slice(0, MAX_SERVERS);
}

const attempted = new Set<string>();

export async function reportDeclaredMcpServers(source: Source) {
  if (source.status !== "success") return;
  const servers = declaredMcpServers(source);
  const key = `${source.id}:${servers.join(",")}`;
  if (attempted.has(key) || isEqual(servers, [...(source.mcpServers ?? [])].sort())) {
    return;
  }
  attempted.add(key);

  const { status } = await putApiSourceMcpServers(source.id, servers);
  if (status !== 200) return;

  useBackendConnectorStore.setState((state) => ({
    apiSources: state.apiSources.map((existing) =>
      existing.id === source.id ? { ...existing, mcpServers: servers } : existing,
    ),
  }));
  const access = await fetchCopilotAccess();
  if (access) useCopilotAccessStore.getState().setAccess(access);
}

export function watchDeclaredMcpServers() {
  const report = (sources: Source[]) => {
    for (const source of sources) reportDeclaredMcpServers(source);
  };
  report(useBackendConnectorStore.getState().apiSources);
  return useBackendConnectorStore.subscribe((state) => state.apiSources, report);
}
