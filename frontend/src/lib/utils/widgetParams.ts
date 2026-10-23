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

export function convertHeadersToRecord<PT extends object = Record<string, unknown>>(
  headers: Record<string, string> | WidgetT["endpointHeaders"] | null,
  params: PT = {} as PT,
) {
  headers = headers || {};

  if (Array.isArray(headers)) {
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
  return { headers, newParams: params };
}

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

export function createURLString(endpoint: string, base?: string | URL) {
  if (endpoint?.startsWith("data:")) return endpoint;

  if (endpoint?.startsWith("http")) return cleanURL(endpoint);

  const baseURL = base?.toString() || "";
  return cleanURL(`${baseURL}/${endpoint}`);
}

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

export function createWidgetEndpoint(
  url: string | Partial<NonNullable<WidgetT["endpoint"]>> | undefined,
): NonNullable<WidgetT["endpoint"]> {
  const given = typeof url === "string" ? { url } : (url ?? {});
  return { url: cleanURL(given.url ?? ""), method: given.method ?? "GET" };
}

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
