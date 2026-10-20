import dayjs from "dayjs";
import type {
  FormInputParamDef,
  NewWidget,
  ParamDef,
  StoredParamValue,
  Ticker,
  WidgetJsonT,
  WidgetT,
} from "~/components/types";
import { getConfig } from "~/lib/runtimeConfig";
import { getIdpTokens } from "~/lib/state/idpTokens";
import { DEFAULT_TICKERS } from "~/lib/types";
import { newParamDef, ParamsSchema } from "~/lib/types/app";
import { isDate } from "~/lib/utils/format";
import type { WidgetType } from "~/utils/zodForms";

function getAuthFlags() {
  const cfg = getConfig();
  return {
    sendMicrosoftIdToken: cfg.authentication.sendMicrosoftIdToken,
    sendOktaIdToken: cfg.authentication.sendOktaIdToken,
    sendUserEmailAsHeader: cfg.authentication.sendUserEmailAsHeader,
  };
}

// Converts header rows (`{ key, value, location }`) to a header record; rows located in the query become params
export function convertHeadersToRecord<PT extends object = Record<string, unknown>>(
  headers: Record<string, string> | WidgetT["endpointHeaders"] | null,
  params: PT = {} as PT,
) {
  headers = headers || {};

  if (Array.isArray(headers)) {
    // The names come from a backend's configuration: the records are built from entries,
    // which only defines properties of their own, so no name reaches a setter or a prototype
    const rows = headers.map(({ key, value, location = "headers" }) => ({
      key,
      value,
      location,
    }));
    const entries = (located: (location: string) => boolean) =>
      rows.filter((row) => located(row.location)).map(({ key, value }) => [key, value]);
    const newHeaders: Record<string, string> = Object.fromEntries(
      entries((location) => location === "headers"),
    );
    const newParams = {
      ...params,
      ...Object.fromEntries(entries((location) => location !== "headers")),
    } as PT;

    headers = addExtraHeaders(newHeaders);
    return { headers, newParams };
  }

  headers = addExtraHeaders(headers);
  // If it's already in the correct format, return it directly
  return { headers, newParams: params };
}

/**
 * A copy of `headers` plus the identity headers the deployment forwards (from page
 * memory). It never changes `headers` itself, so a saved header set (a custom agent's,
 * an MCP server's) never picks up an ID token or the email.
 */
export function addExtraHeaders(
  headers: Record<string, string> = {},
): Record<string, string> {
  const flags = getAuthFlags();
  const { microsoftIdToken, oktaIdToken, email } = getIdpTokens();
  const withExtras = { ...headers };
  if (flags.sendMicrosoftIdToken && microsoftIdToken) {
    withExtras["X-Microsoft-Id-Token"] = microsoftIdToken;
  }
  if (flags.sendOktaIdToken && oktaIdToken) withExtras["X-Okta-Id-Token"] = oktaIdToken;
  if (flags.sendUserEmailAsHeader && email) withExtras["X-Workspace-User"] = email;
  return withExtras;
}

export function cleanURL(url: string) {
  return url?.replace(/([^:]\/)\/+/g, "$1")?.replace(/\/+$/, "");
}

/**
 * Creates a URL string based on the provided endpoint and base URL.
 * @param endpoint - The endpoint to create the URL for.
 * @param base - The base URL to combine with the endpoint. If not provided, defaults to an empty string.
 * @return A cleaned URL string.
 * @example
 * createURLString("widget.json", "https://example.com/widgets");
 * // Returns: "https://example.com/widgets/widget.json"
 */
export function createURLString(endpoint: string, base?: string | URL) {
  // If the endpoint is a data URI, return it as is (without cleanURL to preserve the format)
  if (endpoint?.startsWith("data:")) return endpoint;

  // If the endpoint is a full URL, return it cleaned
  if (endpoint?.startsWith("http")) return cleanURL(endpoint);

  const baseURL = base?.toString() || "";
  // Otherwise, create a new URL based on the base URL and endpoint
  return cleanURL(`${baseURL}/${endpoint}`);
}

/** {@link createURLString} but returns a URL object instead of a string + appends query parameters to the URL */
export function createURL(
  endpoint: string,
  base?: string | URL,
  params?: Record<string, unknown>,
) {
  const url = new URL(createURLString(endpoint, base));
  for (const [key, value] of Object.entries(params || {})) {
    url.searchParams.append(key, String(value));
  }

  return url;
}

const pathUrlRegex = /{([^}]+)}/g;

export function parseMarkdownParams(value: string, params: Record<string, unknown>) {
  if (!value || typeof value !== "string")
    return { parsedValue: value, newParams: params };

  const matches = value.match(pathUrlRegex);

  if (!matches) return { parsedValue: value, newParams: params };

  const newParams = { ...params };

  for (const match of matches) {
    const key = match.slice(1, -1);
    delete newParams[key];
    value = value.replace(match, params[key] ? String(params[key]) : "");
  }

  return { parsedValue: value, newParams };
}

export function parsePathParams(url: string, params: Record<string, unknown>) {
  const { parsedValue, newParams } = parseMarkdownParams(url, params);
  const newUrl = new URL(parsedValue);

  return { newUrl, newParams };
}

// Helper function to clean the URL and add any query parameters
export function cleanSearchParams(
  url: string | WidgetT["endpoint"],
  params: Record<string, unknown> | undefined = undefined,
) {
  url = typeof url === "string" ? url : url?.url;
  if (!url) return "";
  if (!url?.toString()?.includes("http")) return url;

  const { newParams, newUrl } = parsePathParams(url, params ?? {});

  // If the url already has the query parameters, dont add them here
  if (!url?.includes("?")) {
    for (const [key, value] of Object.entries(newParams)) {
      if (value !== undefined && value !== "" && value !== null)
        newUrl.searchParams.set(key, String(value));
    }
  }

  // Remove empty query parameters
  for (const [key, value] of newUrl.searchParams.entries()) {
    if (value === undefined || value === "" || value === null)
      newUrl.searchParams.delete(key);
  }

  return newUrl.toString();
}

type DateModifier<T = number> = {
  mod: "+" | "-";
  amt: T;
  unit: Extract<dayjs.ManipulateType, "h" | "d" | "w" | "M" | "Q" | "y"> | "b";
};

export type DateModifierValue =
  `$currentDate${DateModifier["mod"]}${DateModifier["amt"]}${DateModifier["unit"]}`;

export const dateModRegex = new RegExp(
  /(?:\$(currentDate)(?<mod>[+-]))(?<amt>(\d+))(?<unit>([bhdwmyq]))/i,
);

function modFunction(date: dayjs.Dayjs, dateModifier: DateModifier<string>) {
  const { mod, amt, unit } = dateModifier;
  const num = Number(amt);
  if (unit === "b") {
    return mod === "+" ? date.businessDaysAdd(num) : date.businessDaysSubtract(num);
  }
  return mod === "+" ? date.add(num, unit) : date.subtract(num, unit);
}

export function getDate(date: DateModifierValue | string) {
  return date && dayjs(currentDateModifier(date));
}

export function currentDateModifier(value: DateModifierValue | string) {
  // If it's a regular date string (YYYY-MM-DD), return it as is
  if (isDate(value)) return value;

  const match = dateModRegex.exec(value);
  let date = dayjs();

  if (match?.groups) {
    match.groups.unit = match.groups.unit.replace("m", "M").replace("q", "Q");
    date = modFunction(date, match.groups as DateModifier<string>);
  }

  return date.format("YYYY-MM-DD");
}

function handleEndpointParam<T extends ParamDef | FormInputParamDef>(
  param: T,
  backendURL: string | undefined,
  groupIdCounts: Record<string, number>,
): T {
  if (param?.type === "endpoint" && backendURL) {
    const groupById = param.optionsEndpoint?.split("/")?.pop();
    param.groupById = groupById;
    if (groupById !== undefined && groupIdCounts[groupById] > 1) {
      param.groupById = `${param.paramName}-${groupById}`;
    }
    if (param.optionsEndpoint !== undefined) {
      param.optionsEndpoint = createURLString(param.optionsEndpoint, backendURL);
    }
  }
  return param;
}

function populateGroupByIdCounts(
  params: ParamDef[],
  objectToMutate: Record<string, number>,
) {
  for (const p of params) {
    if (p?.type === "endpoint") {
      const groupById = p?.optionsEndpoint?.split("/")?.pop();
      if (groupById === undefined) continue;
      if (!objectToMutate[groupById]) objectToMutate[groupById] = 0;
      objectToMutate[groupById] = objectToMutate[groupById] + 1;
    }
  }
}

export function createParamDefs(
  widget: Partial<WidgetJsonT | WidgetType | WidgetT>,
  backendURL?: string,
): ParamDef[] {
  const params = ParamsSchema.safeParse(widget.params);
  const groupIdCounts: Record<string, number> = {};

  if (params.success) {
    // The schema validates what a backend sends; its output is the ParamDef shape.
    const parsed = params.data as ParamDef[];
    if (backendURL) populateGroupByIdCounts(parsed, groupIdCounts);

    return parsed.map((param) => {
      param = handleEndpointParam(param, backendURL, groupIdCounts);

      if (param?.type === "form") {
        const inputParams = param?.inputParams?.map((innerParam) => {
          innerParam = handleEndpointParam(innerParam, backendURL, groupIdCounts);
          return newParamDef(innerParam);
        });

        if (param?.endpoint && backendURL) {
          param.endpoint = createURLString(param.endpoint, backendURL);
        }
        return newParamDef({ ...param, inputParams });
      }

      return param?.paramName ? newParamDef(param) : param;
    });
  }

  return widget.params as ParamDef[];
}

/**
 * A widget's endpoint as dashboards and apps save it: the URL and the method, never a
 * data backend's credentials, which widgets look up in their source when they fetch.
 */
export function createWidgetEndpoint(
  url: string | WidgetT["endpoint"],
): NonNullable<WidgetT["endpoint"]> {
  return {
    url: cleanURL(typeof url === "string" ? url : (url?.url ?? "")),
    method: "GET",
  };
}

/** Whether a value, such as one an AI tool call supplies, is one a widget parameter can hold. */
export function isStoredParamValue(value: unknown): value is StoredParamValue {
  const isScalar = (v: unknown) =>
    v === null || ["string", "number", "boolean"].includes(typeof v);
  return isScalar(value) || (Array.isArray(value) && value.every(isScalar));
}

export function createWidgetInitParams(
  widget: NewWidget | WidgetT | WidgetJsonT,
  mainTicker: Ticker = DEFAULT_TICKERS.AAPL,
): Record<string, StoredParamValue> {
  const params = createParamDefs(widget) as ParamDef[];
  const storage = widget?.storage?.params ?? {};

  return Object.fromEntries(
    params.flatMap((param): [string, StoredParamValue][] => {
      const stored = storage[param.paramName];
      if (stored !== undefined) return [[param.paramName, stored]];
      if (param.value === undefined) return [];

      if (param.type === "ticker") return [[param.paramName, mainTicker.symbol]];
      if (param.type === "date" && !dayjs(param.value).isValid()) {
        return [[param.paramName, currentDateModifier(param.value)]];
      }
      return [[param.paramName, param.value]];
    }),
  );
}
