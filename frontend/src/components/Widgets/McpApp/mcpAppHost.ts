// Copyright FINOS contributors. Licensed under the Apache License, Version 2.0.
//
// MCP Apps host helpers. Pure functions only, so the parts that decide
// what an MCP App may do can be tested without a browser.

import { getToolUiResourceUri } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { type McpTool, toolVisibleTo } from "~/lib/state/mcpTools";

export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";
export const SANDBOX_PAGE = "mcp-app-sandbox.html";
/**
 * The view's sandbox. It runs with an opaque origin, so it cannot reach the
 * sandbox page that relays its messages, or keep anything in that origin's storage.
 */
export const INNER_SANDBOX = "allow-scripts allow-forms";
/**
 * The sandbox page's frame. It keeps its own origin, which is already separate
 * from the app's. A nested sandbox cannot grant more than its parent has, so every
 * token of INNER_SANDBOX must be here too.
 */
export const OUTER_SANDBOX = "allow-scripts allow-same-origin allow-forms";
/** The JSON-RPC error code the MCP Apps spec uses when a host refuses a request. */
export const HOST_REFUSAL_CODE = -32000;

export type UiCsp = {
  connectDomains?: string[];
  resourceDomains?: string[];
  frameDomains?: string[];
  baseUriDomains?: string[];
};

export type UiPermissions = {
  camera?: object;
  microphone?: object;
  geolocation?: object;
  clipboardWrite?: object;
};

export type UiResource = {
  html: string;
  csp?: UiCsp;
  permissions?: UiPermissions;
  prefersBorder?: boolean;
};

export type McpAppConfig = {
  serverUrl: string;
  toolName: string;
  toolInput?: Record<string, unknown>;
  /** The name the host last gave the widget, so a name the user typed is never replaced. */
  autoName?: string;
};

/** The `ui://` resource that renders this tool's result, if it has one. */
export function toolUiResourceUri(tool: Pick<McpTool, "_meta">): string | undefined {
  // The SDK throws on a malformed address. This runs while rendering, over the
  // tools of every connected server, so one bad server must not break the page.
  try {
    const uri = getToolUiResourceUri({ _meta: tool._meta });
    return uri?.startsWith("ui://") ? uri : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The spec's visibility rule: an app may call a tool whose visibility includes
 * "app", or that has none. AppBridge forwards tools/call without checking, so the
 * host has to. (The SDK's isToolVisibilityModelOnly refuses only exactly ["model"].)
 */
export function appMayCallTool(tool: Pick<McpTool, "_meta"> | undefined): boolean {
  return tool ? toolVisibleTo(tool, "app") : false;
}

/**
 * Whether the user must allow a call an app makes. A tool that does not say it
 * only reads may change data, and ticking a tool for the Copilot must not let an
 * app run it unseen.
 */
export function appCallNeedsConsent(tool: Pick<NamedTool, "annotations">): boolean {
  return tool.annotations?.readOnlyHint !== true;
}

/** Tools the Copilot may call: those whose visibility includes "model". */
export { modelMayCallTool } from "~/lib/state/mcpTools";

export const MAX_CONTEXT_ROWS = 2000;
export const MAX_CONTEXT_BYTES = 1024 * 1024;
export const MAX_CONTEXT_TEXT = 64 * 1024;

export type AppModelContext = {
  content?: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
};

/**
 * What an app's ui/update-model-context means for the chat. Rows stay a plain array,
 * because that is what the agent turns into a table it can query; anything else
 * reaches the model as clipped text.
 */
export function contextFromApp(
  params: AppModelContext,
): { data: unknown; summary?: string } | null {
  const text = (params.content ?? [])
    .flatMap((block) => (block.type === "text" && block.text ? [block.text] : []))
    .join("\n");
  const rows = params.structuredContent?.rowData;
  if (Array.isArray(rows)) {
    const kept = withinContextLimits(rows);
    const cut =
      kept.length < rows.length
        ? `Only the first ${kept.length} of ${rows.length} rows are available here.`
        : "";
    const summary = [text, cut].filter(Boolean).join(" ");
    return { data: kept, ...(summary ? { summary } : {}) };
  }
  if (text) return { data: text.slice(0, MAX_CONTEXT_TEXT) };
  return params.structuredContent ? { data: params.structuredContent } : null;
}

function withinContextLimits(rows: unknown[]): unknown[] {
  let bytes = 0;
  let count = 0;
  for (const row of rows.slice(0, MAX_CONTEXT_ROWS)) {
    bytes += JSON.stringify(row)?.length ?? 0;
    if (bytes > MAX_CONTEXT_BYTES) break;
    count++;
  }
  return rows.slice(0, count);
}

const isRows = (value: unknown): value is Record<string, unknown>[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every((row) => row && typeof row === "object" && !Array.isArray(row));

function rowsIn(value: unknown): Record<string, unknown>[] | undefined {
  if (isRows(value)) return value;
  if (!value || typeof value !== "object") return undefined;
  return Object.values(value).find(isRows);
}

function parsedText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * For an app that does not say what it shows: the rows in the result of the tool
 * that opened it. It reads the shape of the result, never what the rows mean, and
 * the app's own context replaces it as soon as the app sends one.
 */
export function contextFromToolResult(result: {
  content?: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}): AppModelContext | null {
  if (result.isError) return null;
  const textBlocks = (result.content ?? []).filter(
    (block) => block.type === "text" && block.text,
  );
  const rows =
    rowsIn(result.structuredContent) ??
    textBlocks.map((block) => rowsIn(parsedText(block.text as string))).find(Boolean);
  if (rows) {
    return {
      structuredContent: { rowData: rows },
      content: [
        {
          type: "text",
          text: `${rows.length} rows from the tool result, which may be only part of what the app shows.`,
        },
      ],
    };
  }
  return textBlocks.length > 0 ? { content: textBlocks } : null;
}

type NamedTool = {
  name: string;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; title?: string };
};

/** The widget's name in the catalog (widgets.json). */
export const DEFAULT_WIDGET_NAME = "MCP App";

const MAX_TITLE_CHARS = 80;

/**
 * A label a server chose, made safe to name a widget. The chat lists widgets by
 * name in its prompt, in tags such as [origin: …], so the label is one short line
 * with no brackets or control characters, as the agent does for a view's summary.
 */
function cleanLabel(label: string | undefined): string {
  return (label ?? "")
    .slice(0, MAX_TITLE_CHARS * 4)
    .replace(/\p{Cc}/gu, " ")
    .replace(/[[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TITLE_CHARS)
    .trim();
}

/** What to call a tool: the title its server gives it, else its name. */
export function toolTitle(tool: NamedTool): string {
  return (
    cleanLabel(tool.annotations?.title) || cleanLabel(tool.name) || DEFAULT_WIDGET_NAME
  );
}

/**
 * The name for a widget after it is set to show another tool. The chat names its
 * tables after widgets, so two apps from one server need different names. The
 * widget follows the tool only while it has a name the host gave it; a name the
 * user typed stays.
 */
export function widgetNameForTool(
  currentName: string,
  lastAutoName: string | undefined,
  title: string,
): string {
  const untouched =
    !currentName.trim() ||
    currentName === DEFAULT_WIDGET_NAME ||
    currentName === lastAutoName;
  return untouched ? title : currentName;
}

/** A new widget should not start on a tool that can change data when another one only reads. */
export function defaultTool<T extends NamedTool>(tools: T[]): T | undefined {
  return tools.find((tool) => tool.annotations?.readOnlyHint === true) ?? tools[0];
}

export function runPrompt(tool: NamedTool): string {
  const { readOnlyHint, destructiveHint } = tool.annotations ?? {};
  return readOnlyHint === false || destructiveHint === true
    ? `${tool.name} can change data, so it does not run on its own.`
    : `${tool.name} does not say whether it changes data, so it does not run on its own.`;
}

function decodeBase64Utf8(value: string): string {
  const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

const normalizeMime = (mime: string | undefined) =>
  (mime ?? "").replace(/\s+/g, "").toLowerCase();

/** Pick the UI resource out of a resources/read answer, or say why it is unusable. */
export function parseUiResource(result: ReadResourceResult, uri: string): UiResource {
  const content = result.contents.find((c) => c.uri === uri) ?? result.contents[0];
  if (!content) throw new Error(`The server returned nothing for ${uri}`);
  if (normalizeMime(content.mimeType) !== MCP_APP_MIME_TYPE) {
    throw new Error(
      `${uri} has the type ${content.mimeType ?? "(none)"}, not ${MCP_APP_MIME_TYPE}`,
    );
  }
  let html: string | undefined;
  if ("text" in content && typeof content.text === "string") html = content.text;
  else if ("blob" in content && typeof content.blob === "string") {
    html = decodeBase64Utf8(content.blob);
  }
  if (!html) throw new Error(`${uri} has no HTML`);

  // The Python SDK drops the underscore, so accept both spellings.
  const raw = (content._meta ?? (content as { meta?: unknown }).meta) as
    | { ui?: { csp?: UiCsp; permissions?: UiPermissions; prefersBorder?: boolean } }
    | undefined;
  return {
    html,
    csp: raw?.ui?.csp,
    permissions: raw?.ui?.permissions,
    prefersBorder: raw?.ui?.prefersBorder,
  };
}

const DOMAIN_LISTS = [
  ["connect", "connectDomains"],
  ["resource", "resourceDomains"],
  ["frame", "frameDomains"],
  ["base", "baseUriDomains"],
] as const;

/**
 * The URL of the sandbox page for one view. The declared domains go in the
 * query, and the sandbox origin turns them into the page's CSP header, so the
 * policy is fixed before the view's HTML exists.
 */
export function sandboxFrameUrl(sandboxBase: string, csp: UiCsp | undefined): string {
  const url = new URL(
    SANDBOX_PAGE,
    sandboxBase.endsWith("/") ? sandboxBase : `${sandboxBase}/`,
  );
  for (const [param, key] of DOMAIN_LISTS) {
    const domains = csp?.[key]?.filter((d) => typeof d === "string" && d.length > 0);
    if (domains?.length) url.searchParams.set(param, domains.join(" "));
  }
  return url.toString();
}

export type SandboxCheck =
  | { ok: true; warning?: string }
  | { ok: false; reason: string };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const isLocalHost = (hostname: string) =>
  LOCAL_HOSTS.has(hostname) || hostname.endsWith(".localhost");

const lastTwoLabels = (hostname: string) => hostname.split(".").slice(-2).join(".");

/** A * as the first label of the sandbox host: one origin per MCP server. */
const PER_SERVER = /^https?:\/\/\*\.[^*/?#]+$/i;
/** Stands in for a server's id while the address is checked. */
const SAMPLE_ID = "0".repeat(32);
/** The * that stands for a server's id: the whole first label of the host, nowhere else. */
const ID_LABEL = /^(https?:\/\/)\*(?=\.)/i;

/** The address with id in place of the * of its first label, if it has one. */
function withServerId(template: string, id: string): string {
  return template.replace(ID_LABEL, (_, scheme: string) => scheme + id);
}

/**
 * The sandbox origin has to be a different origin from the app, and should not
 * share a site with it: cookies ignore ports, and SameSite treats subdomains of
 * one registrable domain as the same site. A * as the first label of its host
 * gives every MCP server an origin of its own, so apps from different servers
 * share no storage.
 */
export function checkSandboxOrigin(
  sandboxUrl: string,
  appOrigin: string,
): SandboxCheck {
  const template = sandboxUrl.replace(/\/+$/, "");
  const perServer = template.includes("*");
  if (perServer && !PER_SERVER.test(template)) {
    return {
      ok: false,
      reason:
        "MCP_APPS_SANDBOX_URL may have one * only, as the first label of its host, for example https://*.mcp-sandbox.example.net.",
    };
  }
  let sandbox: URL;
  try {
    sandbox = new URL(withServerId(template, SAMPLE_ID));
  } catch {
    return { ok: false, reason: "MCP_APPS_SANDBOX_URL is not a valid address." };
  }
  if (sandbox.protocol !== "https:" && sandbox.protocol !== "http:") {
    return {
      ok: false,
      reason: "MCP_APPS_SANDBOX_URL must be an http or https address.",
    };
  }
  if (perServer && sandbox.hostname.split(".").length < 3) {
    return {
      ok: false,
      reason:
        "The * in MCP_APPS_SANDBOX_URL must be followed by a domain, not a whole top-level domain.",
    };
  }
  const app = new URL(appOrigin);
  if (sandbox.origin === app.origin) {
    return {
      ok: false,
      reason:
        "The sandbox is on the same origin as the app, which would give MCP Apps access to it.",
    };
  }
  const local = isLocalHost(sandbox.hostname) && isLocalHost(app.hostname);
  const warnings: string[] = [];
  if (!local && lastTwoLabels(sandbox.hostname) === lastTwoLabels(app.hostname)) {
    warnings.push(
      "The sandbox shares a site with the app, so cookies reach it. Use a different domain in production.",
    );
  }
  if (local) warnings.push("Local sandbox: fine for development only.");
  else if (!perServer) {
    warnings.push(
      "Apps from every MCP server share this sandbox origin and its storage. Put a * in MCP_APPS_SANDBOX_URL to give each server its own.",
    );
  }
  return { ok: true, warning: warnings.length ? warnings.join(" ") : undefined };
}

/**
 * A server's label in its sandbox origin: the first 32 hex digits of the SHA-256
 * of its address. It is a valid DNS label and the same on every load.
 */
export async function sandboxIdFor(serverUrl: string): Promise<string> {
  const bytes = new TextEncoder().encode(new URL(serverUrl).href);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

/**
 * The sandbox address for one server: its id in place of the * that is the
 * first label of the host, if there is one. A * anywhere else stays as it is,
 * and checkSandboxOrigin refuses such an address.
 */
export function sandboxBaseFor(sandboxUrl: string, id: string): string {
  return withServerId(sandboxUrl, id);
}

/** Links an MCP App asks the host to open: web addresses only. */
export function safeLink(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
