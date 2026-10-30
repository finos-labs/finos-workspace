import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { ParamDef } from "~/components/types";
import {
  buildOptionsRequest,
  buildWidgetRequest,
  requestInit,
} from "~/lib/utils/widgetRequest";

const OUT = process.env.REFERENCE_OUT ?? "";
const BACKEND = "https://backend.example";

type Credentials = { headers: Record<string, string>; query: Record<string, string> };

interface Built {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}

function widgetOf(
  url: string,
  method: "GET" | "POST",
  params: Record<string, unknown>[],
  values: Record<string, unknown> = {},
) {
  return {
    endpoint: { url: `${BACKEND}${url}`, method },
    params: params as unknown as ParamDef[],
    storage: { params: values as never },
  };
}

function shown(
  built: ReturnType<typeof buildWidgetRequest>,
): Built | { problems: string[] } {
  if (built === null) throw new Error("The widget has no endpoint");
  if (!built.ok) return { problems: built.problems.map((problem) => problem.message) };
  const init = requestInit(built.request);
  return {
    method: built.request.method,
    url: built.request.url,
    headers: init.headers as Record<string, string>,
    ...(built.request.body === undefined
      ? {}
      : { body: JSON.parse(built.request.body) }),
  };
}

function through(param: Record<string, unknown>, value: unknown) {
  const at = (place: string, method: "GET" | "POST") =>
    shown(
      buildWidgetRequest(
        widgetOf("/p", method, [{ paramName: "name", ...param, in: place }], {
          name: value,
        }),
        undefined,
      ),
    );
  const query = at("query", "GET");
  const header = at("header", "GET");
  const body = at("body", "POST");
  const path = shown(
    buildWidgetRequest(
      widgetOf("/p/{name}", "GET", [{ paramName: "name", ...param }], { name: value }),
      undefined,
    ),
  );
  return {
    query: "url" in query ? new URL(query.url).searchParams.get("name") : null,
    header: "headers" in header ? (header.headers.name ?? null) : null,
    body:
      "body" in body && body.body !== undefined
        ? JSON.stringify((body.body as Record<string, unknown>).name)
        : null,
    path: "url" in path ? new URL(path.url).pathname.replace("/p/", "") : null,
  };
}

const valueCases: { label: string; param: Record<string, unknown>; value: unknown }[] =
  [
    { label: "text", param: { type: "text" }, value: "a b" },
    {
      label: "tabs",
      param: { type: "tabs", options: [{ label: "A", value: "a" }] },
      value: "a",
    },
    { label: "number", param: { type: "number" }, value: 12.5 },
    { label: "number, stored as text", param: { type: "number" }, value: "12.5" },
    { label: "boolean", param: { type: "boolean" }, value: true },
    { label: "date", param: { type: "date" }, value: "2024-01-31" },
    { label: "endpoint, with a text value", param: { type: "endpoint" }, value: "a" },
    { label: "endpoint, with a number value", param: { type: "endpoint" }, value: 7 },
    {
      label: "multiSelect or multiple, as a list",
      param: { type: "text", multiSelect: true },
      value: ["a", "b"],
    },
    {
      label: "multiSelect or multiple, as a comma-separated text",
      param: { type: "text", multiple: true },
      value: "a,b",
    },
  ];

const omittedCases: { label: string; value: unknown }[] = [
  { label: "undefined", value: undefined },
  { label: "null", value: null },
  { label: "an empty string", value: "" },
  { label: "an empty list", value: [] },
  { label: "0", value: 0 },
  { label: "false", value: false },
];

const problemCases: { label: string; built: ReturnType<typeof buildWidgetRequest> }[] =
  [
    {
      label: "A path placeholder has no value",
      built: buildWidgetRequest(
        widgetOf("/p/{name}", "GET", [{ paramName: "name", type: "text" }]),
        undefined,
      ),
    },
    {
      label: "A path placeholder names no parameter",
      built: buildWidgetRequest(widgetOf("/p/{other}", "GET", []), undefined),
    },
    {
      label: "A path placeholder takes several values",
      built: buildWidgetRequest(
        widgetOf(
          "/p/{name}",
          "GET",
          [{ paramName: "name", type: "text", multiple: true }],
          { name: "a,b" },
        ),
        undefined,
      ),
    },
    {
      label: "A body parameter on a GET widget",
      built: buildWidgetRequest(
        widgetOf("/p", "GET", [{ paramName: "name", type: "text", in: "body" }], {
          name: "a",
        }),
        undefined,
      ),
    },
    {
      label: "A header name that cannot be sent",
      built: buildWidgetRequest(
        widgetOf("/p", "GET", [{ paramName: "Host", type: "text", in: "header" }], {
          Host: "a",
        }),
        undefined,
      ),
    },
    {
      label: "A header value that is not printable ASCII",
      built: buildWidgetRequest(
        widgetOf("/p", "GET", [{ paramName: "X-Name", type: "text", in: "header" }], {
          "X-Name": "é",
        }),
        undefined,
      ),
    },
    {
      label: "A header that the backend connection sets",
      built: buildWidgetRequest(
        widgetOf("/p", "GET", [{ paramName: "X-Key", type: "text", in: "header" }], {
          "X-Key": "a",
        }),
        { headers: { "X-Key": "secret" }, query: {} } satisfies Credentials,
      ),
    },
    {
      label: "A query value that the backend connection sets",
      built: buildWidgetRequest(
        widgetOf("/p", "GET", [{ paramName: "key", type: "text" }], { key: "a" }),
        { headers: {}, query: { key: "secret" } } satisfies Credentials,
      ),
    },
    {
      label: "A number that is not a number",
      built: buildWidgetRequest(
        widgetOf("/p", "GET", [{ paramName: "name", type: "number" }], { name: "x" }),
        undefined,
      ),
    },
    {
      label: "A boolean that is not true or false",
      built: buildWidgetRequest(
        widgetOf("/p", "GET", [{ paramName: "name", type: "boolean" }], { name: "x" }),
        undefined,
      ),
    },
  ];

const teamReport = widgetOf(
  "/teams/{team}/report",
  "POST",
  [
    { paramName: "team", type: "endpoint", label: "Team" },
    { paramName: "period", type: "text", label: "Period", value: "month" },
    { paramName: "X-Region", type: "text", label: "Region", value: "eu", in: "header" },
    {
      paramName: "filters",
      type: "text",
      label: "Filters",
      value: "active",
      in: "body",
    },
  ],
  { team: "platform" },
);

const teamOptions = {
  paramName: "team",
  type: "endpoint",
  optionsEndpoint: `${BACKEND}/teams/search`,
  optionsMethod: "POST",
  optionsParams: { active: true },
};

describe("the widget request reference", () => {
  it("writes what the request builder does with each kind of value", () => {
    const values = valueCases.map(({ label, param, value }) => ({
      label,
      value: JSON.stringify(value),
      ...through(param, value),
    }));
    const omitted = omittedCases.map(({ label, value }) => {
      const built = shown(
        buildWidgetRequest(
          widgetOf("/p", "GET", [{ paramName: "name", type: "text" }], { name: value }),
          undefined,
        ),
      ) as Built;
      return { label, sent: new URL(built.url).searchParams.has("name") };
    });
    const problems = problemCases.map(({ label, built }) => ({
      label,
      messages: (shown(built) as { problems: string[] }).problems,
    }));
    const examples = [
      {
        label:
          "A POST widget with a path parameter, a query parameter, a header and a body field",
        widget: teamReport,
        optionsParam: teamOptions,
        request: shown(buildWidgetRequest(teamReport, undefined, { theme: "dark" })),
        options: shown(
          buildOptionsRequest(
            teamOptions as never,
            { params: teamReport.params, values: {} },
            undefined,
          ) as never,
        ),
      },
    ];
    expect(values.length).toBe(valueCases.length);
    expect(problems.every((entry) => entry.messages.length > 0)).toBe(true);
    if (OUT === "") return;
    mkdirSync(resolve(OUT), { recursive: true });
    writeFileSync(
      resolve(OUT, "widget-request-reference.json"),
      `${JSON.stringify({ backend: BACKEND, values, omitted, problems, examples }, null, 2)}\n`,
    );
  });
});
