import { readReference } from "./reference.mts";

type Json = Record<string, any>;

const AGENT_ONLY_COMMANDS = ["execute_agent_tool"];

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a.localeCompare(b)))
      : inner,
  );
}

function pluginProblems(problems: string[]): void {
  const backend = readReference("backend", "widget_plugins.json");
  const frontend = readReference("frontend", "plugin-reference.json");
  const check = (what: string, inWebApp: unknown, inApi: unknown): void => {
    if (canonical(inWebApp) !== canonical(inApi)) {
      problems.push(`${what}: the web app has ${JSON.stringify(inWebApp)} and the API has ${JSON.stringify(inApi)}`);
    }
  };
  check("the permissions of a plugin", [...frontend.permissions].sort(), (backend.permissions as Json[]).map((permission) => permission.name));
  check("the host's runtime version", frontend.versions.runtime, backend.host.api);
  check("the host's AFM version", frontend.versions.afm, backend.host.afm);
  check("the pattern of a plugin id", frontend.patterns.pluginId, backend.patterns.pluginId);
  check("the directives of a frame's policy", frontend.csp.directives, backend.csp.directives);
  check("the floor of a frame's policy", frontend.csp.floor, backend.csp.floor);
  check("the most sources of a directive", frontend.csp.maxSources, backend.csp.maxSources);
  check("the longest source", frontend.csp.maxSourceLength, backend.csp.maxSourceLength);
  check("the confirmations of a policy", frontend.csp.confirmations, backend.csp.confirmations);
  check("the private host suffixes", frontend.csp.privateSuffixes, backend.csp.privateSuffixes);
  check("the blocked requests in one report", frontend.limits.MAX_REPORTS_PER_FLUSH, backend.reports.perRequest);
}

function bridgeProblems(problems: string[]): void {
  const backend = readReference("backend", "workspace_bridge.json");
  const frontend = readReference("frontend", "workspace-bridge-reference.json");
  if (canonical(frontend.errorCodes) !== canonical(backend.errorCodes)) {
    problems.push(`the errors of the bridge: the web app has ${JSON.stringify(frontend.errorCodes)} and the API has ${JSON.stringify(backend.errorCodes)}`);
  }
  const sent = (backend.commands as Json[]).map((command) => command.name as string);
  const expected = [...sent, ...AGENT_ONLY_COMMANDS].sort();
  const accepted = [...(frontend.commands as string[])].sort();
  if (canonical(accepted) !== canonical(expected)) {
    problems.push(`the commands of the bridge: the web app runs ${JSON.stringify(accepted)}, and the API sends ${JSON.stringify(sent)} besides ${JSON.stringify(AGENT_ONLY_COMMANDS)}`);
  }
  const presenceMs = (backend.constants.presenceTtlSeconds as number) * 1000;
  if (!((frontend.limits.heartbeatIntervalMs as number) < presenceMs)) {
    problems.push(`the heartbeat of the bridge, ${frontend.limits.heartbeatIntervalMs} ms, is not shorter than the ${presenceMs} ms that the API keeps a presence`);
  }
}

export function checkAgreement(): void {
  const problems: string[] = [];
  pluginProblems(problems);
  bridgeProblems(problems);
  if (problems.length > 0) {
    throw new Error(`The web app and the API disagree:\n${problems.map((problem) => `- ${problem}`).join("\n")}`);
  }
}
