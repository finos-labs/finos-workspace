import type { $ZodIssue } from "zod/v4/core";
import type { ParamDef, WidgetT } from "~/components/types";
import {
  backendTemplateSchema,
  isRenderableVizType,
  isWellFormedVizType,
  KNOWN_TEMPLATE_KEYS,
  WidgetVizTypes,
} from "~/lib/types/app";

const TEMPLATE_KEY_ALIASES: Record<string, string> = {
  mcp_servers: "mcpServers",
};

function normalizeBackendTemplate(template: unknown) {
  if (!template || typeof template !== "object") return template;
  const obj = template as Record<string, unknown>;
  for (const [from, to] of Object.entries(TEMPLATE_KEY_ALIASES)) {
    if (from in obj && !(to in obj)) {
      obj[to] = obj[from];
      delete obj[from];
    }
  }
  return obj;
}

import { type InvalidItem, toInspectableJson } from "~/lib/utils/invalidItems";
import {
  convertHeadersToRecord,
  createParamDefs,
  createURL,
  createURLString,
  createWidgetInitParams,
} from "~/lib/utils/widgetParams";
import {
  detectUnrecognizedKeys,
  type UnrecognizedKeysReport,
  type WidgetsType,
} from "~/utils/zodForms";
import type {
  BackendAgent,
  BackendTemplate,
  Source,
  ValidateBackend,
} from "../state/backendConnector";
import { getJsonWidget } from "./widget";
import { contractProblems } from "./widgetsContractChecks";
import {
  type ComposedWidgetsSchema,
  pluginConfigProblems,
  validateWidgetDefinition,
} from "./widgetsSchemaValidation";

export interface ProbeReport {
  failed: string[];
  unchecked: string[];
}

const PLACEHOLDER = /\{([^{}]+)\}/g;
const PROBE_CONCURRENCY = 6;

function fillRoute(endpoint: string, value: (name: string) => unknown): string | null {
  let missing = false;
  const path = endpoint.split(/[?#]/, 1)[0];
  const filled = path.replace(PLACEHOLDER, (_, name: string) => {
    const v = value(name);
    if (v === undefined || v === null || v === "") missing = true;
    return encodeURIComponent(Array.isArray(v) ? v.join(",") : String(v ?? ""));
  });
  return missing ? null : filled;
}

function probeRoutes(widgets: WidgetsType, backendUrl: URL) {
  const routes = new Map<string, string[]>();
  const unchecked: string[] = [];

  const add = (endpoint: unknown, ref: string, value: (name: string) => unknown) => {
    if (
      typeof endpoint !== "string" ||
      !endpoint.trim() ||
      endpoint.startsWith("data:")
    )
      return;
    const route = fillRoute(endpoint, value);
    if (route === null) {
      unchecked.push(`${ref} - \`${endpoint}\`: a placeholder has no default value`);
      return;
    }
    const url = createURLString(route, backendUrl);
    if (new URL(url).origin !== backendUrl.origin) {
      unchecked.push(`${ref} - \`${endpoint}\`: not on the backend's origin`);
      return;
    }
    routes.set(url, [...(routes.get(url) ?? []), ref]);
  };

  const addOptions = (
    param: ParamDef,
    ref: string,
    defaults: Record<string, unknown>,
  ) => {
    if (param.type !== "endpoint") return;
    const optionsParams = (param.optionsParams ?? {}) as Record<string, unknown>;
    add(param.optionsEndpoint, `${ref}, options of ${param.paramName}`, (name) => {
      const v = optionsParams[name];
      return typeof v === "string" && v.startsWith("$") ? defaults[v.slice(1)] : v;
    });
  };

  for (const [widgetId, widget] of Object.entries(widgets)) {
    const ref = `Widget: ${widgetId}`;
    const defaults: Record<string, unknown> = createWidgetInitParams(
      widget as unknown as WidgetT,
    );
    add(widget.endpoint, ref, (name) => defaults[name]);
    for (const param of (createParamDefs(widget) ?? []) as ParamDef[]) {
      addOptions(param, ref, defaults);
      if (param.type !== "form") continue;
      const formRef = `${ref}, form ${param.paramName}`;
      const inputs: Record<string, unknown> = { ...defaults };
      for (const input of param.inputParams ?? [])
        inputs[input.paramName] = input.value;
      add(param.endpoint, formRef, (name) => inputs[name]);
      for (const input of param.inputParams ?? []) addOptions(input, formRef, inputs);
    }
  }
  return { routes, unchecked };
}

async function sendOptions(url: string, signal?: AbortSignal): Promise<number | null> {
  try {
    const response = await fetch(url, {
      method: "OPTIONS",
      credentials: "omit",
      cache: "no-store",
      signal,
    });
    return response.status;
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}

export async function validateBackendEndpoints(
  widgets: WidgetsType,
  backendUrl: URL,
  signal?: AbortSignal,
): Promise<ProbeReport> {
  const { routes, unchecked } = probeRoutes(widgets, backendUrl);
  if (routes.size === 0) return { failed: [], unchecked };

  const token = Math.random().toString(36).slice(2, 12);
  const canary = await sendOptions(
    createURLString(`__workspace_route_probe_${token}`, backendUrl),
    signal,
  );
  if (canary !== 404) {
    const why =
      canary === null
        ? "the backend did not answer OPTIONS from this origin (it is unreachable, or its CORS settings do not allow OPTIONS)"
        : `the backend answers OPTIONS for a path that does not exist (status ${canary})`;
    return { failed: [], unchecked: [`Routes not checked: ${why}`, ...unchecked] };
  }

  const failed: string[] = [];
  const queue = [...routes.entries()];
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const [url, refs] = next;
      const status = await sendOptions(url, signal);
      const path = new URL(url).pathname;
      if (status === 404)
        failed.push(`${refs.join("; ")} - \`${path}\`: no such route (404)`);
      else if (status === null)
        failed.push(`${refs.join("; ")} - \`${path}\`: no response`);
    }
  };
  await Promise.all(Array.from({ length: PROBE_CONCURRENCY }, worker));
  return { failed: failed.sort(), unchecked };
}

function fileShapeError(object: unknown): string | null {
  const isMap = !!object && typeof object === "object" && !Array.isArray(object);
  const record = object as Record<string, unknown>;
  const isOneWidget =
    isMap && typeof record.name === "string" && typeof record.endpoint === "string";
  if (isMap && !isOneWidget) return null;

  const received = JSON.stringify(object, null, 0)?.slice(0, 38) ?? String(object);
  const jsonStart = received.slice(0, 2);
  const suffix = jsonStart === `{"` ? "}" : jsonStart === "[{" ? "}]" : "";
  return `\n\n[widgets.json]: Invalid format
  Expected: \`{"weekly_summary": {"name": "Weekly summary", ... }}\`
  Received: \`${received.replace(/[\s\W]$/, "")} ... ${suffix}\``;
}

export interface WidgetItems {
  fileError: string | null;
  valid: WidgetsType;
  invalid: InvalidItem[];
  unsupported: string[];
  unrendered: string[];
}

export function validateWidgetItems(
  object: unknown,
  context: {
    schema: ComposedWidgetsSchema;
    pluginTypes?: ReadonlySet<string>;
    credentialHeaders?: string[];
    credentialQuery?: string[];
  },
): WidgetItems {
  const items: WidgetItems = {
    fileError: fileShapeError(object),
    valid: {},
    invalid: [],
    unsupported: [],
    unrendered: [],
  };
  if (items.fileError) return items;

  const valid: [string, WidgetsType[string]][] = [];
  for (const [widgetId, widget] of Object.entries(object as Record<string, unknown>)) {
    if (widgetId === "$schema" || widgetId === "$id") continue;
    if (!widget || typeof widget !== "object" || Array.isArray(widget)) {
      items.invalid.push({
        file: "widgets.json",
        id: widgetId,
        errors: `${widgetId}:\n [widget]: must be an object, received \`${Array.isArray(widget) ? "array" : String(widget)}\``,
        json: toInspectableJson(widget),
      });
      continue;
    }
    const definition = widget as Record<string, unknown>;
    const type = definition.type;
    if (
      typeof type === "string" &&
      isWellFormedVizType(type) &&
      !context.schema["x-types"].includes(type)
    ) {
      items.unsupported.push(widgetId);
      continue;
    }

    const problems = validateWidgetDefinition(context.schema, definition);
    if (problems.length === 0)
      problems.push(
        ...contractProblems(definition, {
          credentialHeaders: context.credentialHeaders,
          credentialQuery: context.credentialQuery,
        }),
      );
    if (problems.length) {
      const name =
        typeof definition.name === "string" && definition.name ? definition.name : "";
      items.invalid.push({
        file: "widgets.json",
        id: widgetId,
        name: name || undefined,
        errors: `${name ? `${name} (${widgetId})` : widgetId}:\n${problems
          .map((p) => ` [${p.pointer.slice(1) || "widget"}]: ${p.message}`)
          .join("\n")}`,
        json: toInspectableJson(definition),
      });
      continue;
    }

    definition.params = createParamDefs(definition);
    valid.push([widgetId, definition as WidgetsType[string]]);
    if (!isRenderableVizType(type as string, context.pluginTypes))
      items.unrendered.push(widgetId);
  }
  return { ...items, valid: Object.fromEntries(valid) as WidgetsType };
}

function widgetErrorMessage(items: WidgetItems) {
  if (items.fileError) return items.fileError;
  return items.invalid.length > 0
    ? items.invalid.map((item) => item.errors).join("\n\n")
    : null;
}

const expectedRegex = /expected one of (.+) - received (.*)/;
function formatZodIssue(issue: $ZodIssue, widgetId?: string): string {
  const {
    message,
    path,
    code,
    expected = "",
    input,
  } = issue as $ZodIssue & { expected?: unknown; input?: unknown };
  const cleanedPath = path.filter((p) => p !== widgetId).join(", ") || "object";

  if (code === "invalid_type") {
    const hint =
      expected && !String(message).includes(String(expected))
        ? ` (expected \`${expected}\`)`
        : "";
    return `[${cleanedPath}]: ${message}${hint}`;
  }
  if (expected && input) {
    const errorMsg = `\nExpected: \`${expected}\` - Received: \`${input}\``;
    return `[${cleanedPath}]: ${code} ${errorMsg}`;
  }

  let errorMsg = message.replace(expectedRegex, (_, exp: string, rec: string) => {
    const expectedFormatted = exp
      .replace(/"/g, "")
      .split("|")
      .map((e) => e.trim())
      .join("` | `");
    return `\nExpected: \`${expectedFormatted}\`\nReceived: \`${rec}\``;
  });
  if (errorMsg.startsWith("\nExpected:")) {
    errorMsg = `${code} ${errorMsg}`;
  }

  return `[${cleanedPath}]: ${errorMsg}`;
}

export function formatZodIssues(
  issues: $ZodIssue[],
  errors: string[] = [],
  widget?: Record<string, unknown>,
  widgetId?: string,
) {
  widgetId =
    widgetId || (typeof widget?.widgetId === "string" ? widget.widgetId : undefined);

  if (issues?.length > 0) {
    const issuesString = issues
      .map((issue) => {
        if (issue.code !== "invalid_union" || issue.inclusive === false)
          return formatZodIssue(issue, widgetId);
        const unionErrors = issue.errors.reduce(
          (acc, unionError) => {
            const curr = Object.fromEntries(
              unionError.map((issue) => [issue.path.join("."), issue]),
            );
            Object.assign(acc, curr);
            return acc;
          },
          {} as Record<string, $ZodIssue>,
        );

        return Object.values(unionErrors)
          .flatMap((issue) => formatZodIssue(issue, widgetId))
          .join(",\n");
      })
      .join(",\n");

    const id = widgetId ? ` (${widgetId})` : "";
    const prefix = widget?.name ? `${widget?.name}${id}:` : "";
    errors.push(`${prefix}\n ${issuesString}`);
  }

  return errors;
}

function templatePluginConfigProblems(
  template: BackendTemplate,
  context: { schema: ComposedWidgetsSchema; widgets: Record<string, unknown> },
): string[] {
  const problems: string[] = [];
  for (const [tabKey, tab] of Object.entries(template.tabs ?? {}))
    (tab.layout ?? []).forEach((item, index) => {
      const plugin = item.state?.storage?.plugin;
      if (!plugin) return;
      const type = (context.widgets[item.i] as { type?: unknown } | undefined)?.type;
      if (typeof type !== "string") return;
      const where = `tabs/${tabKey}/layout/${index}/state/storage/plugin`;
      for (const problem of pluginConfigProblems(
        context.schema,
        type,
        plugin.config ?? {},
      ))
        problems.push(` [${where}/config${problem.pointer}]: ${problem.message}`);
    });
  return problems;
}

function serverNameProblems(
  template: BackendTemplate,
  serverUrls: Map<string, string>,
): string[] {
  const seen = new Map(serverUrls);
  const problems: string[] = [];
  (template.mcpServers ?? []).forEach((server, index) => {
    const url = seen.get(server.name);
    if (url !== undefined && url !== server.url)
      problems.push(
        ` [mcpServers/${index}/name]: \`${server.name}\` already names another MCP server of this backend (${url})`,
      );
    seen.set(server.name, server.url);
  });
  return problems;
}

function checkMcpLinks(items: WidgetItems, templates: BackendTemplate[]) {
  const declared = new Set(
    templates.flatMap((template) => (template.mcpServers ?? []).map((s) => s.name)),
  );
  for (const [id, widget] of Object.entries(items.valid)) {
    const server = widget.mcp_tool?.mcp_server;
    if (server === undefined || declared.has(server)) continue;
    delete items.valid[id];
    items.unrendered = items.unrendered.filter((unrendered) => unrendered !== id);
    items.invalid.push({
      file: "widgets.json",
      id,
      name: widget.name,
      errors: `${widget.name} (${id}):\n [mcp_tool/mcp_server]: \`${server}\` is not an MCP server this backend's apps.json declares`,
      json: toInspectableJson(widget),
    });
  }
}

function partitionTemplates(
  templates: BackendTemplate[],
  file: "apps.json" | "templates.json" = "apps.json",
  context?: { schema: ComposedWidgetsSchema; widgets: Record<string, unknown> },
): { valid: BackendTemplate[]; invalid: InvalidItem[] } {
  const valid: BackendTemplate[] = [];
  const invalid: InvalidItem[] = [];
  const serverUrls = new Map<string, string>();

  for (const template of templates) {
    if (!template || typeof template !== "object") {
      continue;
    }

    const result = backendTemplateSchema.safeParse(template);
    const name = template.name || "Unknown App";
    if (!result.success) {
      invalid.push({
        file,
        id: name,
        name,
        errors: formatZodIssues(result.error.issues, [], { ...template, name }).join(
          "\n\n",
        ),
        json: toInspectableJson(template),
      });
      continue;
    }

    const configProblems = [
      ...(context ? templatePluginConfigProblems(template, context) : []),
      ...serverNameProblems(template, serverUrls),
    ];
    if (configProblems.length) {
      invalid.push({
        file,
        id: name,
        name,
        errors: `${name}:\n${configProblems.join("\n")}`,
        json: toInspectableJson(template),
      });
      continue;
    }
    for (const server of template.mcpServers ?? [])
      serverUrls.set(server.name, server.url);
    valid.push(template);
  }

  return { valid, invalid };
}

export const errorResponse = {
  widgets: {},
  errorMessage: null,
  templates: [] as BackendTemplate[],
  agents: [] as BackendAgent[],
  totalFailed: 1,
  templateErrorMessage: null,
  templateWarningMessage: null,
  unrecognizedKeysMessage: null,
} satisfies ValidateBackend;

const DEFAULT_OPTIONS = {
  validateAllWidgets: false,
  pluginVizTypes: [] as string[],
  widgetsSchema: undefined as ComposedWidgetsSchema | undefined,
  agents: true,
  apps: true,
  extraHeaders: {} as Record<string, string>,
};

export type GetApiSourceWidgetsOptions = Partial<typeof DEFAULT_OPTIONS>;

let defaultPluginVizTypes: string[] = [];
let defaultWidgetsSchema: ComposedWidgetsSchema | undefined;
let schemaWaiters: {
  resolve: (s: ComposedWidgetsSchema) => void;
  reject: (e: Error) => void;
}[] = [];

export function setDefaultPluginVizTypes(types: Iterable<string>) {
  defaultPluginVizTypes = [...types];
}

export function setDefaultWidgetsSchema(schema: ComposedWidgetsSchema | undefined) {
  defaultWidgetsSchema = schema;
  if (!schema) return;
  for (const waiter of schemaWaiters) waiter.resolve(schema);
  schemaWaiters = [];
}

export function failWidgetsSchema(error: Error) {
  for (const waiter of schemaWaiters) waiter.reject(error);
  schemaWaiters = [];
}

export function widgetsSchemaReady(): Promise<ComposedWidgetsSchema> {
  if (defaultWidgetsSchema) return Promise.resolve(defaultWidgetsSchema);
  return new Promise((resolve, reject) => schemaWaiters.push({ resolve, reject }));
}

function credentialNames(source: Source, location: "headers" | "query"): string[] {
  return (source.endpointHeaders ?? [])
    .filter((header) => (header.location ?? "headers") === location && header.key)
    .map((header) => header.key);
}

function parseOptions(
  options?: GetApiSourceWidgetsOptions | boolean,
): GetApiSourceWidgetsOptions {
  const defaults = { ...DEFAULT_OPTIONS, pluginVizTypes: defaultPluginVizTypes };
  if (typeof options === "boolean") {
    return {
      ...defaults,
      validateAllWidgets: options,
    };
  }

  return { ...defaults, ...(options || {}) };
}

function validateWidgetsAppsJson(params: {
  invalidTemplates: InvalidItem[];
  widgetValidationError: string | null;
  failedEndpoints?: string[];
  unrecognizedReports?: UnrecognizedKeysReport[];
}) {
  const {
    invalidTemplates,
    widgetValidationError,
    failedEndpoints = [],
    unrecognizedReports = [],
  } = params;

  const templateErrors = invalidTemplates.map((item) => item.errors);
  const templateErrorMessage =
    templateErrors.length > 0 ? templateErrors.join("\n\n") : null;

  const allWidgetErrors = [];
  if (widgetValidationError) allWidgetErrors.push(widgetValidationError);
  if (failedEndpoints.length > 0) allWidgetErrors.push(...failedEndpoints);

  const errorMessage = allWidgetErrors.length > 0 ? allWidgetErrors.join("\n\n") : null;
  const totalFailed = failedEndpoints.length + templateErrors.length;
  const unrecognizedKeysMessage =
    unrecognizedReports.length > 0 ? unrecognizedReports : null;

  return {
    errorMessage,
    templateErrorMessage,
    unrecognizedKeysMessage,
    totalFailed,
    templateErrors,
  };
}

export async function validateBackend(
  source: Source,
  options?: GetApiSourceWidgetsOptions | boolean,
) {
  options = parseOptions(options);
  const widgetContext = {
    schema: options.widgetsSchema ?? (await widgetsSchemaReady()),
    pluginTypes: new Set(options.pluginVizTypes),
    credentialHeaders: credentialNames(source, "headers"),
    credentialQuery: credentialNames(source, "query"),
  };

  const requestTimeout = 60000;
  const { headers, newParams } = convertHeadersToRecord(source.endpointHeaders);

  Object.assign(headers, options.extraHeaders || {});

  const backendUrl = createURL(source.url);
  const widgetsUrl = createURL("widgets.json", backendUrl, newParams);
  const reqInit = { headers, signal: AbortSignal.timeout(requestTimeout) };

  const widgetsRes = await fetch(widgetsUrl, reqInit).catch((error) => ({
    ok: false,
    status: error.code || 500,
    statusText: error.message || "Network error",
    json: async () => ({}),
    headers: new Headers(),
  }));

  if (!widgetsRes.ok) {
    const statusCode = widgetsRes.status;
    let errorMessage =
      "Unable to find a widgets.json file. Please check the console logs for more details.";

    if (statusCode === 401 || statusCode === 403) {
      errorMessage =
        "Authentication failed. Please check your Authorization header or check the console logs for more details.";
    } else if (statusCode === 404) {
      errorMessage = "The widgets.json file was not found on the server.";
    } else if (statusCode === 422) {
      errorMessage =
        "The server rejected the request. Please check your Authorization header or check the console logs for more details.";
    } else if (statusCode >= 500) {
      errorMessage =
        "Server error occurred. Please try again later or check the console logs for more details.";
    } else if (statusCode === 23) {
      errorMessage = "Request timed out. Please check server status or try again.";
    }

    throw new Error(`${errorMessage} (Status: ${statusCode})`);
  }

  const unrecognizedReports = [] as UnrecognizedKeysReport[];

  const widgetItems = validateWidgetItems(await widgetsRes.json(), widgetContext);
  const widgets = widgetItems.valid;

  let templates: BackendTemplate[] = [];
  let templatesFile: "apps.json" | "templates.json" = "apps.json";
  let agents: BackendAgent[] = [];

  const getPromise = async (fn: () => Promise<Response>, enabled?: boolean) => {
    if (!enabled) return Promise.resolve({ ok: false } as Response);
    return fn().catch(() => ({ ok: false }) as Response);
  };

  const appsPromise = getPromise(async () => {
    const appsUrl = createURL("apps.json", backendUrl, newParams);
    const templatesUrl = createURL("templates.json", backendUrl, newParams);
    return fetch(appsUrl, reqInit).then((res) =>
      res.ok ? res : fetch(templatesUrl, reqInit),
    );
  }, options.apps);

  const agentsPromise = getPromise(async () => {
    const agentsUrl = createURL("agents.json", backendUrl, newParams);
    return fetch(agentsUrl, reqInit);
  }, options.agents);

  let appsKnown = false;
  if (options.apps) {
    const tempsRes = await appsPromise;
    appsKnown = tempsRes.ok || tempsRes.status === 404;

    if (tempsRes.ok) {
      const fileName = tempsRes.url?.endsWith("apps.json")
        ? "apps.json"
        : "templates.json";
      templatesFile = fileName;
      const data = await tempsRes.json().catch(() => []);
      if (Array.isArray(data)) {
        templates = data;
      } else if (data && typeof data === "object" && Object.keys(data).length > 0) {
        templates = [data];
      } else {
        templates = [];
      }

      for (const t of templates) normalizeBackendTemplate(t);

      const report = detectUnrecognizedKeys(
        `[${fileName}]`,
        templates,
        KNOWN_TEMPLATE_KEYS,
      );
      if (report) unrecognizedReports.push(report);
    }
  }

  if (options.agents) {
    const agentsRes = await agentsPromise;

    if (agentsRes.ok) {
      const data = await agentsRes.json().catch(() => []);
      if (Array.isArray(data)) {
        agents = data.filter(
          (agent: unknown) =>
            agent && typeof agent === "object" && "id" in agent && "name" in agent,
        ) as BackendAgent[];
      }
    }
  }

  const templateItems = partitionTemplates(templates, templatesFile, {
    schema: widgetContext.schema,
    widgets,
  });
  if (appsKnown && templateItems.invalid.length === 0)
    checkMcpLinks(widgetItems, templates);
  const unsupportedWidgets = widgetItems.unsupported;
  const unrenderedWidgets = widgetItems.unrendered;
  const widgetValidationError = widgetErrorMessage(widgetItems);

  let probe: ProbeReport = { failed: [], unchecked: [] };
  if (options.validateAllWidgets && !widgetValidationError) {
    probe = await validateBackendEndpoints(widgets, backendUrl, reqInit.signal);
  }
  const failedEndpoints = probe.failed;

  const jsonErrors = validateWidgetsAppsJson({
    invalidTemplates: templateItems.invalid,
    widgetValidationError,
    failedEndpoints,
    unrecognizedReports,
  });

  return {
    widgets: widgetValidationError ? {} : widgets,
    validWidgets: widgetItems.valid,
    unsupportedWidgets,
    unrenderedWidgets,
    ...jsonErrors,
    templates: jsonErrors.templateErrors.length > 0 ? [] : templates,
    validTemplates: templateItems.valid,
    invalidItems: [...widgetItems.invalid, ...templateItems.invalid],
    fatalErrorMessage:
      [widgetItems.fileError, ...failedEndpoints].filter(Boolean).join("\n\n") || null,
    uncheckedRoutes: probe.unchecked,
    agents,
  } as ValidateBackend;
}

export async function validateSource(
  source: Source,
  options?: GetApiSourceWidgetsOptions | boolean,
) {
  const validated = await validateBackend(source, options).catch(
    (e) =>
      ({
        ...errorResponse,
        errorMessage: e.message,
        fatalErrorMessage: e.message,
      }) as ValidateBackend,
  );

  const unsupportedWidgets = validated.unsupportedWidgets ?? [];
  const unrenderedWidgets = validated.unrenderedWidgets ?? [];
  if (unsupportedWidgets.length > 0 || unrenderedWidgets.length > 0) {
    const pluginTypes = (parseOptions(options).pluginVizTypes ?? []).filter(Boolean);
    validated.templateWarningMessage = [
      unsupportedWidgets.length
        ? `[widgets.json]: Not shown, no widget plugin enabled for your organization renders their type: \`${unsupportedWidgets.join("`, `")}\``
        : "",
      unrenderedWidgets.length
        ? `[widgets.json]: Not shown, no widget plugin available to you renders their type: \`${unrenderedWidgets.join("`, `")}\``
        : "",
      `[widgets.json]: Widget types you can use: \`${[...WidgetVizTypes, ...pluginTypes].join("`, `")}\`.`,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  const loadedTemplates = validated.validTemplates ?? validated.templates;
  if (!loadedTemplates.length || validated.fatalErrorMessage) return validated;

  const loadedWidgets = validated.validWidgets ?? validated.widgets;
  const invalidWidgetIds = new Set(
    validated.invalidItems
      ?.filter((item) => item.file === "widgets.json")
      .map((item) => item.id),
  );

  const tabWidgets = new Map<string, Map<string, string[]>>();

  for (const t of loadedTemplates) {
    for (const tab of Object.values(t.tabs || {})) {
      for (const layout of tab.layout || []) {
        const widgetId = layout.i;
        if (getJsonWidget(widgetId)?.name) continue;

        const appTabs = tabWidgets.get(t.name) ?? new Map<string, string[]>();
        const ids = appTabs.get(tab.id) ?? [];
        ids.push(widgetId);
        appTabs.set(tab.id, ids);
        tabWidgets.set(t.name, appTabs);
      }
    }
  }

  for (const [appName, item] of tabWidgets) {
    for (const [tabId, widgetIds] of item) {
      const missingWidgetIds = widgetIds.filter(
        (id) =>
          !(
            loadedWidgets[id] ||
            validated.unsupportedWidgets?.includes(id) ||
            invalidWidgetIds.has(id)
          ),
      );
      if (missingWidgetIds.length === 0) continue;

      const errors = [
        `${appName} (tab: ${tabId}):`,
        `[widgets.json]: Missing widgets used in tab \`${missingWidgetIds.join("`, `")}\``,
      ];

      validated.templateWarningMessage = validated.templateWarningMessage || "";
      validated.templateWarningMessage += `\n\n${errors.join("\n")}`;
    }
  }

  return validated;
}

function slugify(str: string, separator = "-") {
  if (!str) return "";
  return str
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s/g, separator)
    .replace(/\n/g, separator)
    .replace(/[^\w-]+/g, "");
}

export async function getApiSourceWidgets(
  source: Source,
  options?: GetApiSourceWidgetsOptions | boolean,
) {
  const validated = await validateSource(source, options);

  const loadedTemplates = validated.validTemplates ?? validated.templates;
  if (loadedTemplates.length > 0) {
    const processed = loadedTemplates.map((template) => {
      template.id = `custom-${source.id ?? source.uuid}-${slugify(template.name)}`;
      template.templateId = template.templateId || template.id;
      for (const img_key of ["img", "img_dark", "img_light"] as const) {
        const img = template[img_key];
        if (!img) continue;
        template[img_key] = createURLString(img, source.url);
      }
      return template;
    });
    if (validated.validTemplates) validated.validTemplates = processed;
    if (validated.templates.length > 0) validated.templates = processed;
  }

  return validated;
}

function withApiKeyFlag(source: Source) {
  source.hasApiKey = source.endpointHeaders?.some(
    (h) => h.key.toLowerCase() === "authorization" && h.value.startsWith("Bearer "),
  );
  return source;
}

export function processWorkerResults(
  results: { source: Source; result: ValidateBackend }[],
  partial = false,
) {
  return results.reduce(
    (acc, cur) => {
      const { source: apiSource, result } = cur;

      try {
        const fatalErrorMessage = result.validWidgets
          ? result.fatalErrorMessage
          : result.errorMessage;
        if (fatalErrorMessage) {
          apiSource.status = "error";
          acc.apiSources.push(withApiKeyFlag({ ...apiSource }));
          return acc;
        }

        const {
          templateWarningMessage,
          unrecognizedKeysMessage,
          agents,
          invalidItems = [],
        } = result;
        const widgets = result.validWidgets ?? result.widgets;
        const templates = result.validTemplates ?? result.templates;

        if (!partial && invalidItems.length > 0) {
          acc.invalidItems.push({
            source: { name: apiSource.name, id: apiSource.id },
            items: invalidItems,
          });
        }

        if (!partial && templateWarningMessage) {
          acc.toastErrors.push({
            source: { name: apiSource.name, id: apiSource.id },
            message: templateWarningMessage,
          });
        }

        if (!partial && unrecognizedKeysMessage) {
          acc.unrecognizedKeysMessages.push({
            source: { name: apiSource.name, id: apiSource.id },
            reports: unrecognizedKeysMessage,
          });
        }

        apiSource.widgets = Object.entries(widgets).reduce<WidgetsType>(
          (acc, [key, widget]) => {
            widget.params = createParamDefs(widget, apiSource.url);

            acc[key] = {
              ...widget,
              widgetId: key,
              endpointHeaders: apiSource.endpointHeaders,
            };
            return acc;
          },
          {},
        );

        acc.apiSources.push({
          ...apiSource,
          templates,
          agents,
          status: "success",
        });
        return acc;
      } catch (err) {
        console.error(err instanceof Error ? err.message : err);
        acc.apiSources.push(withApiKeyFlag({ ...apiSource }));
        return acc;
      }
    },
    {
      apiSources: [] as Source[],
      toastErrors: [] as { source: { name: string; id: string }; message: string }[],
      unrecognizedKeysMessages: [] as {
        source: { name: string; id: string };
        reports: UnrecognizedKeysReport[];
      }[],
      invalidItems: [] as {
        source: { name: string; id: string };
        items: InvalidItem[];
      }[],
      __partial: partial,
    },
  );
}

export type WorkerResult = ReturnType<typeof processWorkerResults>;
