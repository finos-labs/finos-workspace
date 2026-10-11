import type { $ZodIssue } from "zod/v4/core";
import type { WidgetT } from "~/components/types";
import {
  backendTemplateSchema,
  isWidgetVizType,
  KNOWN_TEMPLATE_KEYS,
  WidgetVizTypes,
} from "~/lib/types/app";

// Snake_case aliases accepted on apps.json templates. Backends following the
// public docs may emit snake_case; we rewrite to camelCase before validation
// so the schema and downstream consumers only see one shape.
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
  cleanSearchParams,
  convertHeadersToRecord,
  createParamDefs,
  createURL,
  createURLString,
  createWidgetInitParams,
} from "~/lib/utils/widgetParams";
import {
  detectUnrecognizedKeys,
  KNOWN_WIDGET_KEYS,
  specificationSchema,
  type UnrecognizedKeysReport,
  type WidgetsType,
  type WidgetType,
} from "~/utils/zodForms";
import type {
  BackendAgent,
  BackendTemplate,
  Source,
  ValidateBackend,
} from "../state/backendConnector";
import { getJsonWidget } from "./widget";

export async function validateBackendEndpoints(
  widgets: WidgetsType,
  backendUrl: URL,
  headers: Record<string, string>,
  signal?: AbortSignal,
) {
  const failedEndpoints: string[] = [];
  for (const widgetId in widgets) {
    const widget = widgets[widgetId];
    const initialParams = createWidgetInitParams(widget as unknown as WidgetT);

    const url = createURLString(widget.endpoint, backendUrl);
    const endpoint = cleanSearchParams(url, initialParams);
    const requestOptions: RequestInit = { method: "GET", headers, signal };

    const endpointRes = await fetch(endpoint, requestOptions).catch(
      (err: Error) =>
        new Response(JSON.stringify({ message: err.message }), {
          status: 500,
          statusText: err.message,
        }),
    );

    if (!endpointRes.ok) {
      if (endpointRes.status === 422 || endpointRes.status === 405) continue;

      const error = await endpointRes.json();
      const errorDetail = error?.detail || error?.message || error?.error || error;
      const errorString = JSON.stringify(errorDetail);

      if (["field required", "missing"].some((e) => errorString.includes(e))) continue;

      failedEndpoints.push(`Widget: ${widgetId} - ${errorString}`);
    }
  }

  return failedEndpoints;
}

/**
 * Splits a widgets.json into the widgets this Workspace renders and the IDs of the
 * rest. The Workspace protocol has more widget types (tables, charts and others)
 * than this build displays; a widget of another type, or with no type (the
 * protocol's default is a table), is left out instead of failing the whole backend.
 */
export function partitionSupportedWidgets(widgets: WidgetsType): {
  supported: WidgetsType;
  unsupported: string[];
} {
  if (!widgets || typeof widgets !== "object" || Array.isArray(widgets)) {
    return { supported: widgets, unsupported: [] };
  }

  const supported = {} as WidgetsType;
  const unsupported: string[] = [];
  for (const [widgetId, widget] of Object.entries(widgets)) {
    // Not a widget at all: it is invalid, which is reported, not a type left out
    if (!widget || typeof widget !== "object" || Array.isArray(widget)) {
      supported[widgetId] = widget;
      continue;
    }

    const type = widget?.type ?? widget?.defaultViz;
    if (typeof type === "string" && isWidgetVizType(type)) supported[widgetId] = widget;
    else unsupported.push(widgetId);
  }

  return { supported, unsupported };
}

const isValidWidget = (widget: unknown): widget is WidgetType => {
  return specificationSchema.safeParse({ data_widget: widget }).success;
};

/**
 * Returns an error message for an invalid object format.
 * This is used when the widgets.json file is not in the expected format.
 * @param object The object to validate.
 * @returns A string error message.
 */
const getInvalidError = (object: unknown): string => {
  const received = JSON.stringify(object, null, 0).slice(0, 38);
  const jsonStart = received.slice(0, 2);
  const suffix = jsonStart === `{"` ? "}" : jsonStart === "[{" ? "}]" : "";

  const error = `\n\n[widgets.json]: Invalid format
  Expected: \`{"table_data": {"name": "Table data", ... }}\`
  Received: \`${received.replace(/[\s\W]$/, "")} ... ${suffix}\``;
  console.error(error);
  return error;
};

/**
 * Validates widgets.json entry by entry. A widget that fails validation is reported on its own
 * and left out, the others are kept. `fileError` is set when the file as a whole is not a map
 * of widgets.
 */
export function validateWidgetItems(object: object): {
  fileError: string | null;
  valid: WidgetsType;
  invalid: InvalidItem[];
} {
  const valid = {} as WidgetsType;
  const invalid: InvalidItem[] = [];
  if (Array.isArray(object) || isValidWidget(object)) {
    return { fileError: getInvalidError(object), valid, invalid };
  }

  // Mutate params in place. `cloneDeep` removed: downstream (`processWorkerResults`)
  // recomputes `widget.params` from scratch anyway, so the mutation is harmless and
  // the clone was the dominant cost for backends with hundreds/thousands of widgets.
  const widgets = object as Record<string, WidgetType>;

  for (const widgetId in widgets) {
    const widget = widgets[widgetId];

    if (!widget || typeof widget !== "object" || Array.isArray(widget)) {
      invalid.push({
        file: "widgets.json",
        id: widgetId,
        errors: `${widgetId}:\n [object]: Expected an object, received \`${Array.isArray(widget) ? "array" : String(widget)}\``,
        json: toInspectableJson(widget),
      });
      continue;
    }

    const sentParams = widget.params;
    widget.params = createParamDefs(widget);

    const parsedWidget = specificationSchema.safeParse({ [widgetId]: widget });
    const errors = formatZodIssues(
      parsedWidget.error?.issues ?? [],
      [],
      widget,
      widgetId,
    );

    if (errors.length === 0) {
      valid[widgetId] = widget as WidgetsType[string];
      continue;
    }

    invalid.push({
      file: "widgets.json",
      id: widgetId,
      name: typeof widget.name === "string" && widget.name ? widget.name : undefined,
      errors: errors.join("\n\n"),
      // The widget as the backend sent it, not with the parameters computed above
      json: toInspectableJson({ ...widget, params: sentParams }),
    });
  }

  if (import.meta.env.DEV) console.log("Valid widgets.json");

  return { fileError: null, valid, invalid };
}

/** The widgets.json problems as one message: the file's, or each invalid widget's. */
function widgetErrorMessage(items: ReturnType<typeof validateWidgetItems>) {
  if (items.fileError) return items.fileError;
  return items.invalid.length > 0
    ? items.invalid.map((item) => item.errors).join("\n\n")
    : null;
}

export function validateObject(object: object): null | string {
  return widgetErrorMessage(validateWidgetItems(object));
}

const expectedRegex = /expected one of (.+) - received (.*)/;
function formatZodIssue(issue: $ZodIssue, widgetId?: string): string {
  // Which of the fields an issue has depends on its code
  const {
    message,
    path,
    code,
    expected = "",
    input,
  } = issue as $ZodIssue & { expected?: unknown; input?: unknown };
  const cleanedPath = path.filter((p) => p !== widgetId).join(", ") || "object";

  if (code === "invalid_type") {
    // The app's error messages can be as short as "Invalid input": say what was expected
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

/**
 * Validates apps.json entry by entry. An app that fails validation is reported on its own
 * and left out, the others are kept.
 */
function partitionTemplates(
  templates: BackendTemplate[],
  file: "apps.json" | "templates.json" = "apps.json",
): { valid: BackendTemplate[]; invalid: InvalidItem[] } {
  const valid: BackendTemplate[] = [];
  const invalid: InvalidItem[] = [];

  for (const template of templates) {
    // Skip null, undefined, or invalid templates
    if (!template || typeof template !== "object") {
      continue;
    }

    const result = backendTemplateSchema.safeParse(template);
    if (result.success) {
      valid.push(template);
      continue;
    }

    const name = template.name || "Unknown App";
    invalid.push({
      file,
      id: name,
      name,
      errors: formatZodIssues(result.error.issues, [], { ...template, name }).join(
        "\n\n",
      ),
      json: toInspectableJson(template),
    });
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
  agents: true,
  apps: true,
  extraHeaders: {} as Record<string, string>,
};

export type GetApiSourceWidgetsOptions = Partial<typeof DEFAULT_OPTIONS>;

function parseOptions(
  options?: GetApiSourceWidgetsOptions | boolean,
): GetApiSourceWidgetsOptions {
  if (typeof options === "boolean") {
    return {
      ...DEFAULT_OPTIONS,
      validateAllWidgets: options,
    };
  }

  return { ...DEFAULT_OPTIONS, ...(options || {}) };
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

  // combine widget validation errors and endpoint errors
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

// Modify the validateBackend function to include template validation
export async function validateBackend(
  source: Source,
  options?: GetApiSourceWidgetsOptions | boolean,
) {
  options = parseOptions(options);

  // 60s timeout when you connect - in the future we can do something else here -
  // let user set it or turn off for on prem?
  const requestTimeout = 60000;
  const { headers, newParams } = convertHeadersToRecord(source.endpointHeaders);

  Object.assign(headers, options.extraHeaders || {}); // Merge extra headers into the main headers object

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

    // Handle specific status codes with more descriptive messages
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

  // Detect unrecognized keys — widget check is gated behind successful
  // validation (malformed data would produce noisy warnings), while the
  // template check runs independently since templates have their own pipeline.
  const unrecognizedReports = [] as UnrecognizedKeysReport[];

  const rawWidgets = (await widgetsRes.json()) as WidgetsType;
  const { supported: widgets, unsupported: unsupportedWidgets } =
    partitionSupportedWidgets(rawWidgets);
  const widgetItems = validateWidgetItems(widgets);
  const widgetValidationError = widgetErrorMessage(widgetItems);

  if (!widgetItems.fileError) {
    const report = detectUnrecognizedKeys(
      "[widgets.json]",
      Object.values(widgetItems.valid),
      KNOWN_WIDGET_KEYS,
    );
    if (report) unrecognizedReports.push(report);
  }
  // don't early return here - continue to check templates even if widgets have errors,
  // this is so we can still show the user the apps they have and the errors they have
  let failedEndpoints: string[] = [];
  if (options.validateAllWidgets && !widgetValidationError) {
    failedEndpoints = await validateBackendEndpoints(
      widgets,
      backendUrl,
      headers,
      reqInit.signal,
    );
  }

  let templates: BackendTemplate[] = [];
  let templatesFile: "apps.json" | "templates.json" = "apps.json";
  let agents: BackendAgent[] = [];

  const getPromise = async (fn: () => Promise<Response>, enabled?: boolean) => {
    if (!enabled) return Promise.resolve({ ok: false } as Response);
    return fn().catch(() => ({ ok: false }) as Response);
  };

  // After widgets validated, fire apps + agents in parallel (independent of each other).
  const appsPromise = getPromise(async () => {
    const appsUrl = createURL("apps.json", backendUrl, newParams);
    const templatesUrl = createURL("templates.json", backendUrl, newParams);
    return fetch(appsUrl, reqInit).then((res) =>
      res.ok ? res : fetch(templatesUrl, reqInit),
    );
  }, options.apps);

  const agentsPromise = getPromise(async () => {
    const agentsUrl = createURL("agents.json", backendUrl);
    return fetch(agentsUrl, reqInit);
  }, options.agents);

  if (options.apps) {
    const tempsRes = await appsPromise;

    if (tempsRes.ok) {
      const fileName = tempsRes.url?.endsWith("apps.json")
        ? "apps.json"
        : "templates.json";
      templatesFile = fileName;
      const data = await tempsRes.json().catch(() => []);
      // Handle different response types properly:
      // - [] (empty array) -> []
      // - {} (empty object) -> [] (treat as no templates)
      // - undefined/null -> []
      // - [template1, template2] -> [template1, template2]
      // - {valid template object} -> [{valid template object}]
      if (Array.isArray(data)) {
        templates = data;
      } else if (data && typeof data === "object" && Object.keys(data).length > 0) {
        templates = [data];
      } else {
        templates = []; // Handle empty object {}, null, undefined, etc.
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

  const templateItems = partitionTemplates(templates, templatesFile);
  const jsonErrors = validateWidgetsAppsJson({
    invalidTemplates: templateItems.invalid,
    widgetValidationError,
    failedEndpoints,
    unrecognizedReports,
  });

  return {
    widgets: widgetValidationError ? {} : widgets, // return empty widgets if validation failed
    validWidgets: widgetItems.valid,
    unsupportedWidgets,
    ...jsonErrors,
    templates: jsonErrors.templateErrors.length > 0 ? [] : templates, // return empty templates if validation failed
    validTemplates: templateItems.valid,
    invalidItems: [...widgetItems.invalid, ...templateItems.invalid],
    // What leaves nothing usable: the file is not a map of widgets, or endpoints are unreachable
    fatalErrorMessage:
      [widgetItems.fileError, ...failedEndpoints].filter(Boolean).join("\n\n") || null,
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
  if (unsupportedWidgets.length > 0) {
    validated.templateWarningMessage = [
      `[widgets.json]: Not shown, this Workspace does not render their widget type: \`${unsupportedWidgets.join("`, `")}\``,
      `[widgets.json]: Supported widget types: \`${WidgetVizTypes.join("`, `")}\`. A widget with no \`type\` is a table, which is not supported.`,
    ].join("\n\n");
  }

  // What loads: an invalid widget or app does not take the others down with it
  const loadedTemplates = validated.validTemplates ?? validated.templates;
  if (!loadedTemplates.length || validated.fatalErrorMessage) return validated;

  const loadedWidgets = validated.validWidgets ?? validated.widgets;
  const invalidWidgetIds = new Set(
    validated.invalidItems
      ?.filter((item) => item.file === "widgets.json")
      .map((item) => item.id),
  );

  const tabWidgets = {} as { [appName: string]: { [tabId: string]: string[] } };

  for (const t of loadedTemplates) {
    for (const tab of Object.values(t.tabs || {})) {
      for (const layout of tab.layout || []) {
        const widgetId = layout.i;
        if (getJsonWidget(widgetId)?.name) continue; // skip if it's a built-in widget

        if (!tabWidgets[t.name]) tabWidgets[t.name] = {};
        if (!tabWidgets[t.name][tab.id]) tabWidgets[t.name][tab.id] = [];
        tabWidgets[t.name][tab.id].push(widgetId);
      }
    }
  }

  // check for widgets used in apps that are missing from the backend widgets
  for (const [appName, item] of Object.entries(tabWidgets)) {
    for (const [tabId, widgetIds] of Object.entries(item)) {
      const missingWidgetIds = widgetIds.filter(
        (id) =>
          !(
            loadedWidgets[id] ||
            validated.unsupportedWidgets?.includes(id) ||
            // Already reported as invalid
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
    // do some validation here
    const processed = loadedTemplates.map((template) => {
      template.id = `custom-${source.id ?? source.uuid}-${slugify(template.name)}`;
      template.templateId = template.templateId || template.id;
      // handle relative URLs for images
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
        // An invalid widget or app is skipped and reported, the backend still loads. Only a
        // backend with nothing usable (unreachable, not a widgets.json) is an error.
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
            const subCategory = widget.sub_category ?? widget.subCategory;

            acc[key] = {
              ...widget,
              widgetId: key,
              subCategory,
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
