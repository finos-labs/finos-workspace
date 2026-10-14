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
import type { AuthStore } from "~/lib/state/auth";
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

// Avoids importing the entire auth store in this utils file, which causes `heap out of memory` on build.
export function getAuthStore() {
  const AuthStore = {
    getState: () => {
      const localState = localStorage.getItem("auth-storage");
      return localState ? (JSON.parse(localState).state ?? {}) : {};
    },
  } as AuthStore;
  return AuthStore;
}

// Converts header rows (`{ key, value, location }`) to a header record; rows located in the query become params
export function convertHeadersToRecord<PT extends object = Record<string, unknown>>(
  headers: Record<string, string> | WidgetT["endpointHeaders"] | null,
  params: PT = {} as PT,
) {
  headers = headers || {};

  if (Array.isArray(headers)) {
    const newHeaders = headers.reduce<Record<string, string>>(
      (acc, { key, value, location = "headers" }) => {
        if (location === "headers") acc[key] = value;
        else (params as Record<string, unknown>)[key] = value;

        return acc;
      },
      {},
    );

    headers = addExtraHeaders(newHeaders);
    return { headers, newParams: params };
  }

  headers = addExtraHeaders(headers);
  // If it's already in the correct format, return it directly
  return { headers, newParams: params };
}

export function addExtraHeaders(
  headers: Record<string, string> = {},
): Record<string, string> {
  const flags = getAuthFlags();
  if (typeof window === "undefined") return headers; // Ensure this code only runs in the browser
  const useAuthStore = getAuthStore();
  if (flags.sendMicrosoftIdToken) {
    const microsoftIdToken = useAuthStore.getState().microsoftIdToken;
    if (microsoftIdToken) headers["X-Microsoft-Id-Token"] = microsoftIdToken;
  }
  if (flags.sendOktaIdToken) {
    const oktaIdToken = useAuthStore.getState().oktaIdToken;
    if (oktaIdToken) headers["X-Okta-Id-Token"] = oktaIdToken;
  }
  if (flags.sendUserEmailAsHeader) {
    const email = useAuthStore.getState().user?.email;
    if (email) headers["X-Workspace-User"] = email;
  }
  return headers;
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

/** A widget's endpoint with the backend connection's credentials; GET unless it says. */
export function createWidgetEndpoint(
  url:
    | string
    | (Partial<NonNullable<WidgetT["endpoint"]>> & { url: string })
    | undefined,
  endpointHeaders: WidgetT["endpointHeaders"] = [],
): NonNullable<WidgetT["endpoint"]> {
  const given: Partial<NonNullable<WidgetT["endpoint"]>> =
    typeof url === "string" ? { url } : (url ?? {});
  const newEndpoint = {
    query: {},
    headers: {},
    ...given,
    method: given?.method ?? "GET",
  } as NonNullable<WidgetT["endpoint"]>;

  newEndpoint.url = cleanURL(newEndpoint.url);

  const { headers = {}, query = {} } = endpointHeaders.reduce<{
    headers: Record<string, string>;
    query: Record<string, string>;
  }>(
    (acc, { key, value, location = "headers" }) => {
      acc[location][key] = value;
      return acc;
    },
    { headers: newEndpoint.headers ?? {}, query: newEndpoint.query ?? {} },
  );

  return { ...newEndpoint, headers, query };
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
