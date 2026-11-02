export const POLICY_DIRECTIVES = [
  "connect-src",
  "img-src",
  "font-src",
  "media-src",
  "style-src",
  "script-src",
  "worker-src",
  "frame-src",
] as const;
type Policy = Partial<Record<string, string[]>>;

export const CONFIRMATIONS = [
  "insecure-scheme",
  "private-host",
  "remote-script",
] as const;
export type Confirmation = (typeof CONFIRMATIONS)[number];

export const MAX_SOURCES = 32;
export const MAX_SOURCE_LENGTH = 255;

export const FLOOR: Record<string, string[]> = {
  "default-src": ["'none'"],
  "base-uri": ["'none'"],
  "object-src": ["'none'"],
  "form-action": ["'none'"],
  "script-src": ["blob:"],
  "style-src": ["'unsafe-inline'", "blob:"],
  "img-src": ["data:", "blob:"],
  "font-src": ["data:", "blob:"],
  "media-src": ["data:", "blob:"],
  "worker-src": ["blob:"],
  "connect-src": ["'none'"],
  "frame-src": ["'none'"],
};

const LABEL = "(?!-)[a-z0-9-]{1,63}(?<!-)";
const HOST = new RegExp(`^(\\*\\.)?${LABEL}(\\.${LABEL})*$`);
const URL_SOURCE =
  /^(?<scheme>https|wss|http|ws):\/\/(?<host>[^/:?#@]+)(?<port>:\d{1,5})?(?<path>\/[^?#]*)?$/;
const HASH = /^'sha(256|384|512)-[A-Za-z0-9+/]+={0,2}'$/;
const BAD_CHARACTERS = /[\s,;"<>&\\`]/;
export const PRIVATE_SUFFIXES = [
  ".local",
  ".internal",
  ".localhost",
  ".home.arpa",
  ".lan",
];

interface PolicyCheck {
  errors: string[];
  needs: Set<Confirmation>;
}

function isIp(host: string) {
  const bare = host.replace(/^\[|\]$/g, "");
  return /^[0-9.]+$/.test(bare) || bare.includes(":");
}

function checkUrl(directive: string, source: string, check: PolicyCheck) {
  const match = URL_SOURCE.exec(source);
  if (!match?.groups) {
    check.errors.push(`${directive}: '${source}' is not a valid source`);
    return;
  }
  const { scheme, host, port } = match.groups;
  if ((scheme === "wss" || scheme === "ws") && directive !== "connect-src") {
    check.errors.push(
      `${directive}: ${scheme}:// sources are only valid in connect-src`,
    );
    return;
  }
  if (scheme === "http" || scheme === "ws") check.needs.add("insecure-scheme");
  if (isIp(host)) {
    check.needs.add("private-host");
  } else if (!HOST.test(host)) {
    check.errors.push(
      `${directive}: '${source}' has a host that is not a lowercase DNS name`,
    );
    return;
  } else {
    const bare = host.replace(/^\*\./, "");
    if (host.startsWith("*.") && !bare.includes(".")) {
      check.errors.push(`${directive}: a wildcard needs at least two labels`);
      return;
    }
    if (
      bare === "localhost" ||
      !bare.includes(".") ||
      PRIVATE_SUFFIXES.some((suffix) => bare.endsWith(suffix))
    )
      check.needs.add("private-host");
  }
  if (port) {
    const value = Number(port.slice(1));
    if (!(value > 0 && value < 65536))
      check.errors.push(`${directive}: '${source}' has an invalid port`);
  }
  if (directive === "script-src") check.needs.add("remote-script");
}

function checkSource(directive: string, source: unknown, check: PolicyCheck) {
  if (typeof source !== "string" || !source) {
    check.errors.push(`${directive}: sources are non-empty strings`);
    return;
  }
  if (source.length > MAX_SOURCE_LENGTH) {
    check.errors.push(`${directive}: a source longer than ${MAX_SOURCE_LENGTH}`);
    return;
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the check is for non-ASCII
  if (/[^\x00-\x7f]/.test(source) || BAD_CHARACTERS.test(source)) {
    check.errors.push(
      `${directive}: '${source}' contains a character that is not allowed`,
    );
    return;
  }
  if (source === "data:" || source === "blob:") return;
  if (source.startsWith("'")) {
    if (source === "'unsafe-eval'" || source === "'wasm-unsafe-eval'") {
      if (directive !== "script-src")
        check.errors.push(`${directive}: ${source} is only valid in script-src`);
      return;
    }
    if (source === "'unsafe-inline'") {
      if (directive !== "style-src")
        check.errors.push(`${directive}: 'unsafe-inline' is only valid in style-src`);
      return;
    }
    if (HASH.test(source)) {
      if (directive !== "script-src" && directive !== "style-src")
        check.errors.push(
          `${directive}: hashes are only valid in script-src and style-src`,
        );
      return;
    }
    check.errors.push(`${directive}: ${source} is not allowed`);
    return;
  }
  if (source === "*" || /^[a-z][a-z0-9+.-]*:$/.test(source)) {
    check.errors.push(`${directive}: '${source}' is too broad; name a host`);
    return;
  }
  checkUrl(directive, source, check);
}

export function checkPolicy(
  policy: unknown,
  options: { confirmations?: Iterable<string>; override?: boolean } = {},
): PolicyCheck {
  const check: PolicyCheck = { errors: [], needs: new Set() };
  if (policy === null || policy === undefined) return check;
  if (typeof policy !== "object" || Array.isArray(policy)) {
    check.errors.push("the policy must be an object of directive to sources");
    return check;
  }
  for (const [directive, sources] of Object.entries(policy)) {
    if (!(POLICY_DIRECTIVES as readonly string[]).includes(directive)) {
      check.errors.push(`${directive}: not a directive a plugin policy may set`);
      continue;
    }
    if (!Array.isArray(sources)) {
      check.errors.push(`${directive}: must be a list of sources`);
      continue;
    }
    if (sources.length > MAX_SOURCES) {
      check.errors.push(`${directive}: more than ${MAX_SOURCES} sources`);
      continue;
    }
    if (sources.includes("'none'")) {
      if (sources.length > 1)
        check.errors.push(`${directive}: 'none' must be the only source`);
      continue;
    }
    for (const source of sources) checkSource(directive, source, check);
  }
  const given = new Set(options.confirmations ?? []);
  for (const needed of [...check.needs].sort()) {
    if (given.has(needed)) continue;
    check.errors.push(
      options.override
        ? `needs the confirmation '${needed}'`
        : `needs a superuser override with the confirmation '${needed}'`,
    );
  }
  return check;
}

const TCP_PREFIX = "tcp://";

export function checkNetwork(
  network: readonly unknown[],
  options: {
    confirmations?: Iterable<string>;
    override?: boolean;
    backend?: boolean;
  } = {},
): PolicyCheck {
  const check: PolicyCheck = { errors: [], needs: new Set() };
  for (const source of network) {
    if (typeof source === "string" && source.startsWith(TCP_PREFIX)) {
      checkTcp(source, check, options.backend ?? false);
      continue;
    }
    checkSource("connect-src", source, check);
    if (typeof source === "string" && !/^https:\/\/[^/?#]+$/.test(source))
      check.errors.push(`server.network: '${source}' is not an https origin`);
  }
  const given = new Set(options.confirmations ?? []);
  const missing = [...check.needs].filter((needed) => !given.has(needed)).sort();
  if (check.needs.size && !options.override)
    check.errors.push(
      "server.network: a private host or an IP address needs a superuser's override",
    );
  else if (options.override && missing.length)
    check.errors.push(`server.network: confirm ${missing.join(", ")}`);
  return check;
}

function checkTcp(source: string, check: PolicyCheck, backend: boolean) {
  if (!backend) {
    check.errors.push(
      `server.network: '${source}' is for a plugin backend, and this plugin declares none`,
    );
    return;
  }
  if (!/^tcp:\/\/[^/?#*:]+:\d{1,5}$/.test(source)) {
    check.errors.push(`server.network: '${source}' is not tcp://host:port`);
    return;
  }
  checkSource("connect-src", `https://${source.slice(TCP_PREFIX.length)}`, check);
}

export function compose(policy: Policy): Record<string, string[]> {
  const effective: Record<string, string[]> = Object.fromEntries(
    Object.entries(FLOOR).map(([directive, sources]) => [directive, [...sources]]),
  );
  for (const [directive, sources] of Object.entries(policy)) {
    const added = (sources ?? []).filter((source) => source !== "'none'");
    if (!added.length || !(directive in effective)) continue;
    const base = effective[directive].filter((source) => source !== "'none'");
    effective[directive] = [
      ...base,
      ...added.filter((source) => !base.includes(source)),
    ];
  }
  return effective;
}

export function hosts(policy: Policy): string[] {
  const found: string[] = [];
  for (const sources of Object.values(policy)) {
    for (const source of sources ?? []) {
      const host = URL_SOURCE.exec(source)?.groups?.host;
      if (host && !found.includes(host)) found.push(host);
    }
  }
  return found;
}

type Risk = "none" | "low" | "medium" | "high" | "critical";

export function directiveRisk(directive: string, sources: string[]): Risk {
  const remote = sources.filter((source) => URL_SOURCE.test(source));
  const insecure = remote.some(
    (source) =>
      source.startsWith("http://") ||
      source.startsWith("ws://") ||
      isIp(URL_SOURCE.exec(source)?.groups?.host ?? ""),
  );
  if (insecure) return "critical";
  if (directive === "script-src" && remote.length) return "critical";
  if ((directive === "connect-src" || directive === "frame-src") && remote.length)
    return "high";
  if (remote.length || sources.includes("'unsafe-eval'")) return "medium";
  if (sources.includes("'wasm-unsafe-eval'")) return "low";
  return "none";
}

const SAFE_TOKEN = /^[^\s;,"<>&\\`]+$/;

export function serialize(
  effective: Record<string, string[]>,
  shellHash: string,
): string {
  const parts: string[] = [];
  const withShell = {
    ...effective,
    "script-src": [`'${shellHash}'`, ...(effective["script-src"] ?? [])],
  };
  for (const [directive, sources] of Object.entries(withShell)) {
    if (!/^[a-z-]+$/.test(directive)) throw new Error(`invalid directive ${directive}`);
    for (const source of sources) {
      if (!SAFE_TOKEN.test(source)) throw new Error(`invalid source ${source}`);
    }
    parts.push([directive, ...sources].join(" "));
  }
  return parts.join("; ");
}
