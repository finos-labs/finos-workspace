import type {
  FormInputParamDef,
  ParamDef,
  ParamDefT,
  StoredParamValue,
  WidgetT,
} from "~/components/types";
import {
  HEADER_VALUE_PATTERN,
  type HttpMethod,
  isAllowedHeaderName,
} from "~/lib/types/widgetsContract";
import { addExtraHeaders, currentDateModifier, dateModRegex } from "./widgetParams";
import { PLACEHOLDER, placeholders } from "./widgetsContractChecks";

/**
 * The one place a request to a backend is built from a definition and the current param
 * values (docs/widget-plugins/WIDGETS-JSON.md 4): a widget's data request, an `endpoint`
 * param's option lookup and a form's submission. The widgets, the parameter bar and the
 * Copilot all call it, so an agent gets what the widget gets.
 */

/** A request ready to send. */
export interface BackendRequest {
  /** With its query: the credentials', the params' and the host's */
  url: string;
  method: HttpMethod | "PUT";
  /** The backend connection's credential headers; their values stay out of cache keys */
  credentials: Record<string, string>;
  /** The params sent as headers */
  paramHeaders: Record<string, string>;
  /** A JSON body */
  body?: string;
}

/** Why a request is not sent: a param that needs a value, or has one that cannot go. */
export interface RequestProblem {
  paramName: string;
  kind: "missing" | "invalid";
  message: string;
}

export type BuiltRequest =
  | { ok: true; request: BackendRequest }
  | { ok: false; problems: RequestProblem[] };

/** The backend connection's credentials on a widget instance. */
type Credentials = Pick<NonNullable<WidgetT["endpoint"]>, "headers" | "query">;

/** A widget's endpoint, its declared params and their stored values. */
type WidgetValues = Pick<WidgetT, "endpoint" | "params"> & {
  storage?: { params?: Record<string, StoredParamValue> };
};

type AnyParam = ParamDef | FormInputParamDef;
type Location = "path" | "query" | "header" | "body";
type JsonScalar = string | number | boolean;

const HEADER_VALUE = new RegExp(HEADER_VALUE_PATTERN);

export class RequestProblemsError extends Error {
  readonly problems: RequestProblem[];

  constructor(problems: RequestProblem[]) {
    super(problems.map((p) => p.message).join("\n"));
    this.name = "RequestProblemsError";
    this.problems = problems;
  }
}

function isEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

type Serialized =
  | { ok: true; value: string | JsonScalar | JsonScalar[] }
  | { ok: false; message: string };

function scalarFor(
  param: AnyParam | undefined,
  value: unknown,
): { ok: true; value: JsonScalar } | { ok: false; message: string } {
  const name = param?.paramName ?? "";
  if (typeof value === "object" && value !== null)
    return { ok: false, message: `\`${name}\` has a value that is not a single value` };
  // A literal of an option lookup keeps its JSON type
  if (!param) return { ok: true, value: value as JsonScalar };
  switch (param.type) {
    case "number": {
      const number = typeof value === "number" ? value : Number(String(value).trim());
      return Number.isFinite(number)
        ? { ok: true, value: number }
        : { ok: false, message: `\`${name}\` is not a number` };
    }
    case "boolean":
      if (value === true || value === "true") return { ok: true, value: true };
      if (value === false || value === "false") return { ok: true, value: false };
      return { ok: false, message: `\`${name}\` is not true or false` };
    case "date": {
      const text = String(value);
      return {
        ok: true,
        value: dateModRegex.test(text) ? currentDateModifier(text) : text,
      };
    }
    case "endpoint":
    case "button":
      return { ok: true, value: value as JsonScalar };
    default:
      return { ok: true, value: String(value) };
  }
}

/**
 * A value as WIDGETS-JSON 4.3 sends it: a string in the path, the query or a header, and
 * a JSON value in a body. Call with a value that is not empty.
 */
function serialize(
  param: AnyParam | undefined,
  value: unknown,
  at: Location,
): Serialized {
  const many = !!(param?.multiSelect || param?.multiple) || Array.isArray(value);
  if (many) {
    if (at === "path")
      return {
        ok: false,
        message: `\`${param?.paramName}\` fills a path placeholder, which takes one value`,
      };
    const items = Array.isArray(value)
      ? value
      : typeof value === "string"
        ? value.split(",")
        : [value];
    const scalars: JsonScalar[] = [];
    for (const item of items.filter((item) => !isEmpty(item))) {
      const scalar = scalarFor(param, item);
      if (!scalar.ok) return scalar;
      scalars.push(scalar.value);
    }
    return at === "body"
      ? { ok: true, value: scalars }
      : { ok: true, value: scalars.map(String).join(",") };
  }
  const scalar = scalarFor(param, value);
  if (!scalar.ok) return scalar;
  return at === "body" ? scalar : { ok: true, value: String(scalar.value) };
}

/**
 * Fills each `{name}` with its value, encoded as one path segment (4.2). A placeholder
 * whose value is empty, or that nothing fills, is a problem: the request is not sent.
 */
function fillPath(
  template: string,
  resolve: (name: string) => { param?: AnyParam; value: unknown } | null,
  problems: RequestProblem[],
): string {
  return template.replace(PLACEHOLDER, (_match, name: string) => {
    const found = resolve(name);
    if (!found) {
      problems.push({
        paramName: name,
        kind: "invalid",
        message: `\`{${name}}\` names no param`,
      });
      return "";
    }
    if (isEmpty(found.value)) {
      problems.push({
        paramName: name,
        kind: "missing",
        message: `\`${name}\` needs a value`,
      });
      return "";
    }
    const serialized = serialize(found.param, found.value, "path");
    if (!serialized.ok) {
      problems.push({ paramName: name, kind: "invalid", message: serialized.message });
      return "";
    }
    return encodeURIComponent(String(serialized.value));
  });
}

/** The URL with the connection's query credentials; a relative path is on this origin. */
function startUrl(
  href: string,
  credentials: Credentials | undefined,
  problems: RequestProblem[],
): URL {
  let url: URL;
  try {
    url = new URL(href, globalThis.location?.href);
  } catch {
    problems.push({
      paramName: "",
      kind: "invalid",
      message: `\`${href}\` is not a URL`,
    });
    return new URL("about:blank");
  }
  for (const [key, value] of Object.entries(credentials?.query ?? {}))
    url.searchParams.set(key, value);
  return url;
}

function lowerKeys(record: Record<string, string> | undefined): Set<string> {
  return new Set(Object.keys(record ?? {}).map((key) => key.toLowerCase()));
}

/** Places one non-path value in the query, the headers or the body. */
function place(
  param: AnyParam | undefined,
  name: string,
  value: unknown,
  at: Exclude<Location, "path">,
  target: {
    url: URL;
    method: BackendRequest["method"];
    credentials: Credentials | undefined;
    paramHeaders: Record<string, string>;
    body: Record<string, unknown>;
  },
  problems: RequestProblem[],
) {
  if (isEmpty(value)) return;
  const invalid = (message: string) =>
    problems.push({ paramName: name, kind: "invalid", message });

  if (at === "query" && lowerKeys(target.credentials?.query).has(name.toLowerCase()))
    return invalid(`\`${name}\` is a query value the backend connection sets`);
  if (at === "header") {
    if (!isAllowedHeaderName(name))
      return invalid(`\`${name}\` cannot be sent as a header`);
    if (lowerKeys(target.credentials?.headers).has(name.toLowerCase()))
      return invalid(`\`${name}\` is a header the backend connection sets`);
  }
  if (at === "body" && target.method === "GET")
    return invalid(`\`${name}\` goes in the body, which needs the method POST`);

  const serialized = serialize(param, value, at);
  if (!serialized.ok) return invalid(serialized.message);
  if (at === "body") {
    target.body[name] = serialized.value;
    return;
  }
  const text = String(serialized.value);
  if (at === "query") {
    target.url.searchParams.append(name, text);
    return;
  }
  if (!HEADER_VALUE.test(text))
    return invalid(
      `\`${name}\` is sent as a header, so its value must be printable ASCII of at most 1,024 characters`,
    );
  target.paramHeaders[name] = text;
}

function finish(
  target: {
    url: URL;
    method: BackendRequest["method"];
    credentials: Credentials | undefined;
    paramHeaders: Record<string, string>;
    body: Record<string, unknown>;
  },
  problems: RequestProblem[],
  alwaysBody = false,
): BuiltRequest {
  if (problems.length) return { ok: false, problems };
  const hasBody = alwaysBody || Object.keys(target.body).length > 0;
  return {
    ok: true,
    request: {
      url: target.url.toString(),
      method: target.method,
      credentials: { ...(target.credentials?.headers ?? {}) },
      paramHeaders: target.paramHeaders,
      ...(hasBody ? { body: JSON.stringify(target.body) } : {}),
    },
  };
}

/** The params a widget's request carries: every declared param but a form. */
function requestParams(params: WidgetT["params"]): ParamDef[] {
  return ((params ?? []) as (ParamDef | ParamDef[])[])
    .flat()
    .filter((param) => param && param.type !== "form" && !!param.paramName);
}

/** A param's current value: the one stored for it, else its default. */
function currentValue(
  param: AnyParam,
  values: Record<string, unknown> | undefined,
): unknown {
  return values && param.paramName in values ? values[param.paramName] : param.value;
}

/**
 * A widget's data request (4.1): the endpoint with its path params filled, the query and
 * header params, and the body params as JSON when the method is POST. `hostQuery` is what
 * the host adds itself, such as `theme` and `raw`. Null when the widget has no endpoint.
 */
export function buildWidgetRequest(
  widget: WidgetValues,
  hostQuery: Record<string, string> = {},
): BuiltRequest | null {
  const endpoint = widget.endpoint;
  if (!endpoint?.url) return null;
  const method = endpoint.method ?? "GET";
  if (endpoint.url.startsWith("data:"))
    return {
      ok: true,
      request: { url: endpoint.url, method: "GET", credentials: {}, paramHeaders: {} },
    };

  const params = requestParams(widget.params);
  const values = widget.storage?.params;
  const byName = new Map(params.map((param) => [param.paramName, param]));
  const problems: RequestProblem[] = [];

  const pathNames = new Set(placeholders(endpoint.url));
  const path = fillPath(
    endpoint.url,
    (name) => {
      const param = byName.get(name);
      return param ? { param, value: currentValue(param, values) } : null;
    },
    problems,
  );
  const target = {
    url: startUrl(path, endpoint, problems),
    method,
    credentials: endpoint,
    paramHeaders: {},
    body: {},
  };
  for (const param of params) {
    if (pathNames.has(param.paramName)) continue;
    place(
      param,
      param.paramName,
      currentValue(param, values),
      param.in ?? "query",
      target,
      problems,
    );
  }
  for (const [key, value] of Object.entries(hostQuery))
    target.url.searchParams.set(key, value);
  return finish(target, problems);
}

/**
 * An `endpoint` param's option lookup (4.7): `optionsEndpoint` with its placeholders filled
 * from `optionsParams`, the other `optionsParams` in the query (GET) or a JSON body (POST).
 * A `$name` value is the current value of the param `name` among `scope`. Null when the
 * param has no `optionsEndpoint`.
 */
export function buildOptionsRequest(
  param: ParamDefT<"endpoint"> | Extract<FormInputParamDef, { type: "endpoint" }>,
  scope: { params: AnyParam[]; values?: Record<string, unknown> },
  credentials: Credentials | undefined,
): BuiltRequest | null {
  if (!param.optionsEndpoint) return null;
  const method = param.optionsMethod ?? "GET";
  const optionsParams = param.optionsParams ?? {};
  const byName = new Map(scope.params.map((p) => [p.paramName, p]));
  const problems: RequestProblem[] = [];

  const resolve = (key: string) => {
    if (!(key in optionsParams)) return null;
    const value = optionsParams[key];
    if (typeof value !== "string" || !value.startsWith("$")) return { value };
    const ref = byName.get(value.slice(1));
    return ref
      ? { param: ref, value: currentValue(ref, scope.values) }
      : { value: scope.values?.[value.slice(1)] };
  };

  const pathNames = new Set(placeholders(param.optionsEndpoint));
  const path = fillPath(param.optionsEndpoint, resolve, problems);
  const target = {
    url: startUrl(path, credentials, problems),
    method,
    credentials,
    paramHeaders: {},
    body: {},
  };
  for (const key of Object.keys(optionsParams)) {
    if (pathNames.has(key)) continue;
    const found = resolve(key);
    place(
      found?.param,
      key,
      found?.value,
      method === "POST" ? "body" : "query",
      target,
      problems,
    );
  }
  return finish(target, problems);
}

/**
 * What a form's `{name}` and `$name` refer to: its own inputs, with the values entered,
 * then the widget's params.
 */
export function formScope(
  form: ParamDefT<"form">,
  inputValues: Record<string, unknown>,
  widget: WidgetValues,
): { params: AnyParam[]; values: Record<string, unknown> } {
  const inputs = form.inputParams ?? [];
  const names = new Set(inputs.map((input) => input.paramName));
  return {
    params: [
      ...inputs,
      ...requestParams(widget.params).filter((param) => !names.has(param.paramName)),
    ],
    values: { ...(widget.storage?.params ?? {}), ...inputValues },
  };
}

/**
 * A form's submission: its inputs as a JSON body to its own endpoint, with its own method.
 * The endpoint's placeholders are filled from the form's inputs or the widget's params.
 */
export function buildFormRequest(
  form: ParamDefT<"form">,
  inputValues: Record<string, unknown>,
  widget: WidgetValues,
): BuiltRequest {
  const scope = formScope(form, inputValues, widget);
  const byName = new Map(scope.params.map((param) => [param.paramName, param]));
  const problems: RequestProblem[] = [];
  const path = fillPath(
    form.endpoint,
    (name) => {
      const param = byName.get(name);
      return param ? { param, value: currentValue(param, scope.values) } : null;
    },
    problems,
  );
  const target = {
    url: startUrl(path, widget.endpoint, problems),
    method: form.method ?? "POST",
    credentials: widget.endpoint,
    paramHeaders: {},
    body: inputValues,
  };
  return finish(target, problems, true);
}

/** A GET of a URL with the connection's credential headers, for requests no param shapes. */
export function plainRequest(
  url: string,
  credentials: Record<string, string> = {},
): BuiltRequest {
  return {
    ok: true,
    request: { url, method: "GET", credentials: { ...credentials }, paramHeaders: {} },
  };
}

/**
 * What `fetch` takes for a request (4.1): the credentials, then the headers the deployment
 * adds, then the header params, and the body as JSON.
 */
export function requestInit(
  request: BackendRequest,
  init: RequestInit = {},
): RequestInit {
  return {
    ...init,
    method: request.method,
    headers: {
      ...addExtraHeaders({ ...request.credentials }),
      ...request.paramHeaders,
      ...(request.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    },
    ...(request.body === undefined ? {} : { body: request.body }),
  };
}

/**
 * What identifies a request's response in a cache (4.6): the method, the URL with its
 * query, the header params' values and the body. Credential values stay out.
 */
export function requestKey(built: BuiltRequest): string[] {
  if (!built.ok) return ["problems", JSON.stringify(built.problems)];
  const { method, url, paramHeaders, body, credentials } = built.request;
  return [
    method,
    url,
    JSON.stringify(paramHeaders),
    body ?? "",
    JSON.stringify(Object.keys(credentials).sort()),
  ];
}
