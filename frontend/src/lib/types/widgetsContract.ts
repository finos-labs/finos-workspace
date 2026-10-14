import { z } from "zod";

/**
 * The `widgets.json` contract a backend writes (docs/widget-plugins/WIDGETS-JSON.md): every
 * accepted key and value, closed and bounded. It is the source of the schema kit
 * (`scripts/generate-widgets-schema.ts`) that the API composes into the schema in force
 * for an entity, built-in types plus the types of the plugins enabled there. The SPA
 * validates a backend against that composed schema.
 *
 * Relative imports only: the generator runs this module under Node.
 */

export const EditorLanguages = [
  "sql",
  "javascript",
  "python",
  "json",
  "html",
  "css",
  "markdown",
  "xml",
  "text",
] as const;

export const HTTP_METHODS = ["GET", "POST"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** Where a param goes in the widget's request (WIDGETS-JSON 4). The path is not one. */
export const PARAM_LOCATIONS = ["query", "header", "body"] as const;
export type ParamLocation = (typeof PARAM_LOCATIONS)[number];

// -- Headers (WIDGETS-JSON 4.4, rule 6) -------------------------------------------------

/** An HTTP token, as a header name: the name of a header param. */
export const HEADER_NAME_PATTERN = "^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,64}$";

/** Names a browser forbids page script to set; `fetch` drops them silently. */
export const FORBIDDEN_HEADER_NAMES = [
  "accept-charset",
  "accept-encoding",
  "access-control-request-headers",
  "access-control-request-method",
  "connection",
  "content-length",
  "cookie",
  "date",
  "dnt",
  "expect",
  "host",
  "keep-alive",
  "origin",
  "referer",
  "set-cookie",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "via",
] as const;
export const FORBIDDEN_HEADER_PREFIXES = ["proxy-", "sec-"] as const;

/** Names the host sets on a widget's request, or reserves. */
export const RESERVED_HEADER_NAMES = [
  "authorization",
  "content-type",
  "accept",
  "x-microsoft-id-token",
  "x-okta-id-token",
  "x-workspace-user",
] as const;

/** A header param's value: printable ASCII, at most 1,024 characters. */
export const HEADER_VALUE_PATTERN = "^[\\x20-\\x7E]{0,1024}$";

/** Whether a param may be sent as a header with this name (case-insensitive). */
export function isAllowedHeaderName(name: string): boolean {
  if (!new RegExp(HEADER_NAME_PATTERN).test(name)) return false;
  const lower = name.toLowerCase();
  return !(
    (FORBIDDEN_HEADER_NAMES as readonly string[]).includes(lower) ||
    (RESERVED_HEADER_NAMES as readonly string[]).includes(lower) ||
    FORBIDDEN_HEADER_PREFIXES.some((prefix) => lower.startsWith(prefix))
  );
}

// -- Bounds ----------------------------------------------------------------------------

export const LIMITS = {
  name: 200,
  description: 4000,
  label: 200,
  category: 100,
  paramName: 128,
  endpoint: 2048,
  textValue: 4096,
  shortValue: 64,
  options: 1000,
  params: 64,
  rowParams: 16,
  optionsParams: 32,
  mcpArgs: 32,
  mcpArgValue: 256,
  cron: 100,
  dataKey: 256,
} as const;

/** `endpoint` and `optionsEndpoint`: a path or an absolute URL, with no `?` and no `#`. */
const Endpoint = z
  .string()
  .min(1)
  .max(LIMITS.endpoint)
  .regex(/^[^?#]+$/)
  .meta({
    description:
      "a path or an absolute URL with no `?` and no `#` (a static query value is a param with show: false)",
  });

const Label = z.string().max(LIMITS.label);
const Scalar = z.union([z.string().max(LIMITS.textValue), z.number(), z.boolean()]);
const NullableScalar = z.union([
  z.string().max(LIMITS.textValue),
  z.number(),
  z.boolean(),
  z.null(),
]);

const OptionItem = z.strictObject({
  label: Label,
  value: NullableScalar.optional(),
});
const Options = z
  .array(OptionItem)
  .max(LIMITS.options)
  .meta({ description: "The choices of a dropdown, as `{ label, value }`" });

// -- Params ----------------------------------------------------------------------------

/** Keys every param and every form input accepts. */
const ParamFields = {
  paramName: z.string().min(1).max(LIMITS.paramName).meta({
    description:
      "The name the value is sent under: a query name, a header name or a body key. Unique in the widget; a `{paramName}` placeholder in the endpoint takes the value instead",
  }),
  label: Label.meta({
    description: "The control's label; the paramName by default",
  }).optional(),
  description: z
    .string()
    .max(LIMITS.description)
    .meta({ description: "Help shown on hover, which the AI Agent also reads" })
    .optional(),
  show: z
    .boolean()
    .meta({
      description:
        "false hides the control; the value is still sent, as when a parameter group or another widget supplies it",
    })
    .optional(),
  row: z
    .int()
    .min(0)
    .max(31)
    .meta({ description: "The row of the parameter bar the control is placed in" })
    .optional(),
  roles: z
    .array(z.literal("fileSelector"))
    .max(1)
    .meta({
      description:
        "`fileSelector`: the param picks the file the widget shows, at most one per widget",
    })
    .optional(),
  placeholder: Label.meta({
    description: "Shown in the control while it is empty",
  }).optional(),
  style: z
    .strictObject({ popupWidth: z.number().min(100).max(1000).optional() })
    .meta({ description: "`popupWidth`: the width of a dropdown's list, in pixels" })
    .optional(),
  options: Options.optional(),
  multiSelect: z
    .boolean()
    .meta({
      description:
        "Several values can be chosen; sent joined with commas, or as a list in a body",
    })
    .optional(),
};

/** A param of the widget's request also says where it goes. */
const ParamCommon = {
  ...ParamFields,
  in: z
    .enum(PARAM_LOCATIONS)
    .meta({
      description:
        "Where the value goes: `query` (the default), `header` or `body` (which needs the method POST). A param in a path placeholder declares none",
    })
    .optional(),
};

const NumberValue = z.union([
  z.number(),
  z
    .string()
    .max(LIMITS.shortValue)
    .regex(/^-?\d*\.?\d*$/),
]);
// A value is a literal, or `$name`: the current value of the widget's param `name`
const OptionsParams = z.record(z.string().max(LIMITS.paramName), Scalar).meta({
  maxProperties: LIMITS.optionsParams,
  description:
    "Values for the options request: a `{name}` placeholder of optionsEndpoint takes one, the rest go in the query (GET) or a JSON body (POST). `$name` is the current value of the param `name`",
});
const OptionsEndpoint = Endpoint.meta({
  description:
    "a path or an absolute URL with no `?` and no `#`, which answers with the choices as a list of strings or `{ label, value }`",
});
const OptionsMethod = z.enum(HTTP_METHODS).meta({
  description: "How the options are requested: GET (the default) or POST",
});

const TextParam = z.strictObject({
  ...ParamCommon,
  type: z.literal("text"),
  value: z
    .string()
    .max(LIMITS.textValue)
    .meta({ description: "The default value" })
    .nullish(),
  multiple: z
    .boolean()
    .meta({ description: "Several values can be entered, sent like multiSelect" })
    .optional(),
  language: z
    .enum(EditorLanguages)
    .meta({
      description: "The value is code in this language, edited in a code editor",
    })
    .optional(),
});
const TabsParam = z.strictObject({
  ...ParamCommon,
  type: z.literal("tabs"),
  value: z
    .string()
    .max(LIMITS.textValue)
    .meta({ description: "The default value" })
    .nullish(),
});
const TickerParam = z.strictObject({
  ...ParamCommon,
  type: z.literal("ticker"),
  value: z
    .string()
    .max(LIMITS.shortValue)
    .meta({ description: "The default value" })
    .nullish(),
});
const DateParam = z.strictObject({
  ...ParamCommon,
  type: z.literal("date"),
  value: z
    .string()
    .max(LIMITS.shortValue)
    .meta({
      description:
        "The default: a date, `YYYY-MM-DD`, or `$currentDate` with a modifier such as `$currentDate-1M`",
    })
    .nullish(),
});
const NumberParam = z.strictObject({
  ...ParamCommon,
  type: z.literal("number"),
  value: NumberValue.meta({
    description: "The default: a number, or a string of digits",
  }).nullish(),
});
const BooleanParam = z.strictObject({
  ...ParamCommon,
  type: z.literal("boolean"),
  value: z.boolean().meta({ description: "The default value" }).nullish(),
});
const ButtonParam = z.strictObject({
  ...ParamCommon,
  type: z.literal("button"),
  value: NullableScalar.meta({ description: "The default value" }).optional(),
});
const EndpointParam = z.strictObject({
  ...ParamCommon,
  type: z.literal("endpoint"),
  value: z
    .union([NullableScalar, z.array(Scalar).max(LIMITS.options)])
    .meta({
      description:
        "The default: an option's value, or a list of them for multiSelect (or a comma-separated string)",
    })
    .optional(),
  optionsEndpoint: OptionsEndpoint.optional(),
  optionsMethod: OptionsMethod.optional(),
  optionsParams: OptionsParams.optional(),
});

/** An input of a form param: posted in the form's own JSON body, so it has no `in`. */
const FormInputParam = z.discriminatedUnion("type", [
  z.strictObject({
    ...ParamFields,
    type: z.literal("text"),
    value: z.string().max(LIMITS.textValue).nullish(),
  }),
  z.strictObject({
    ...ParamFields,
    type: z.literal("date"),
    value: z.string().max(LIMITS.shortValue).nullish(),
  }),
  z.strictObject({
    ...ParamFields,
    type: z.literal("number"),
    value: NumberValue.nullish(),
  }),
  z.strictObject({
    ...ParamFields,
    type: z.literal("boolean"),
    value: z.boolean().nullish(),
  }),
  z.strictObject({
    ...ParamFields,
    type: z.literal("button"),
    value: NullableScalar.optional(),
  }),
  z.strictObject({
    ...ParamFields,
    type: z.literal("endpoint"),
    value: NullableScalar.optional(),
    optionsEndpoint: OptionsEndpoint.optional(),
    optionsMethod: OptionsMethod.optional(),
    optionsParams: OptionsParams.optional(),
  }),
]);

/** A form posts its inputs as a JSON body to its own endpoint, with its own method. */
const FormParam = z.strictObject({
  type: z.literal("form"),
  paramName: z
    .string()
    .min(1)
    .max(LIMITS.paramName)
    .meta({ description: "A name for the form; it is not sent" })
    .optional(),
  label: ParamFields.label,
  description: ParamFields.description,
  show: ParamFields.show,
  row: ParamFields.row,
  endpoint: Endpoint.meta({
    description:
      "a path or an absolute URL with no `?` and no `#`, which receives the form's inputs as a JSON body; `{name}` takes an input's or a param's value",
  }),
  method: z
    .enum(["POST", "PUT"])
    .meta({ description: "How the form is sent: POST (the default) or PUT" })
    .optional(),
  inputParams: z
    .array(FormInputParam)
    .max(32)
    .meta({ description: "The form's fields, each like a param, with no `in`" }),
});

export const ParamDefContract = z.discriminatedUnion("type", [
  TextParam,
  TabsParam,
  TickerParam,
  DateParam,
  NumberParam,
  BooleanParam,
  ButtonParam,
  EndpointParam,
  FormParam,
]);
export type ParamDefContractT = z.infer<typeof ParamDefContract>;

// -- The MCP tool opt-in (WIDGETS-JSON 5) ------------------------------------------------

export const McpToolContract = z
  .strictObject({
    // The name of a server in the same backend's apps.json mcpServers, not a URL
    mcp_server: z.string().min(1).max(128),
    tool_id: z.string().min(1).max(128),
    // A tool argument to `$paramName` or a literal; whole when present, identity when absent
    args: z
      .record(
        z.string().max(LIMITS.paramName),
        z.union([z.string().max(LIMITS.mcpArgValue), z.number(), z.boolean()]),
      )
      .meta({ maxProperties: LIMITS.mcpArgs })
      .optional(),
  })
  .meta({
    description:
      "The MCP tool of this backend the AI Agent uses to query what the widget shows: a server named in this backend's apps.json mcpServers, and the tool (WIDGETS-JSON 5)",
  });
export type McpToolContractT = z.infer<typeof McpToolContract>;

// -- The widget ----------------------------------------------------------------------------

const Cron = z.string().trim().min(1).max(LIMITS.cron);

/**
 * Keys every widget definition accepts, whatever its type. `type`, `data` and the keys of
 * one type are added per type by the composer (WIDGETS-JSON 3.4).
 */
export const WidgetBaseContract = z.strictObject({
  name: z
    .string()
    .min(1)
    .max(LIMITS.name)
    .meta({ description: "The title the widget shows" }),
  description: z.string().max(LIMITS.description).meta({
    description:
      "What the widget shows; the catalog shows it, and the AI Agent finds widgets by it",
  }),
  endpoint: Endpoint,
  method: z
    .enum(HTTP_METHODS)
    .meta({
      description:
        "How Workspace calls the endpoint: GET (the default) or POST, which a param `in: body` needs",
    })
    .optional(),
  category: z
    .string()
    .max(LIMITS.category)
    .meta({ description: "The group the catalog lists the widget under" })
    .optional(),
  subCategory: z
    .string()
    .max(LIMITS.category)
    .meta({ description: "The subgroup within the category" })
    .optional(),
  source: z
    .union([
      z.string().max(LIMITS.category),
      z.array(z.string().max(LIMITS.category)).max(16),
    ])
    .meta({ description: "Where the data comes from: a label, or a list of labels" })
    .optional(),
  showTitle: z
    .boolean()
    .meta({ description: "false leaves the title off the widget" })
    .optional(),
  params: z
    .array(z.union([ParamDefContract, z.array(ParamDefContract).max(LIMITS.rowParams)]))
    .max(LIMITS.params)
    .meta({
      description:
        "The widget's parameters; an item that is a list of params is one row of the parameter bar",
    })
    .optional(),
  gridData: z
    .strictObject({ w: z.int().min(1).max(40), h: z.int().min(1).max(100) })
    .meta({
      description:
        "The default size on a dashboard, in grid units: `w` of 40 columns, and `h` rows",
    })
    .optional(),
  staleTime: z
    .union([z.number().min(1000).max(1e10), z.literal(false)])
    .meta({
      description:
        "Milliseconds a response is reused before it is fetched again; false fetches every time",
    })
    .optional(),
  refetchInterval: z
    .union([z.number().min(1000).max(1e10), z.literal(false), Cron])
    .meta({
      description:
        "Fetch again every so many milliseconds, or on a 5-field cron schedule; false never",
    })
    .nullish(),
  dataUpdateDisplay: Cron.meta({
    description:
      "When the data changes, as a 5-field cron expression shown to the user",
  }).optional(),
  runButton: z
    .boolean()
    .meta({ description: "The widget fetches only when the user clicks Run" })
    .optional(),
  disableRetrievalForCopilot: z
    .boolean()
    .meta({
      description:
        "Keeps the widget's data from the AI Agent; such a widget has no `mcp_tool`",
    })
    .optional(),
  exportable: z
    .boolean()
    .meta({ description: "false removes Export from the widget's menu" })
    .optional(),
  mcp_tool: McpToolContract.optional(),
});
export type WidgetBaseContractT = z.infer<typeof WidgetBaseContract>;

/** `data` of every type: `dataKey`, the path of the widget's data in a JSON response. */
export const DataContract = z
  .strictObject({
    dataKey: z
      .string()
      .max(LIMITS.dataKey)
      .meta({
        description:
          "The path of the widget's data in a JSON response, such as `result.items`",
      })
      .optional(),
  })
  .meta({
    description:
      "`dataKey`, and for a plugin's type the configuration its plugin defines",
  });

/** What a built-in type adds to the base, and its request rules (WIDGETS-JSON 4.4). */
export interface BuiltInTypeContract {
  /** What the type is for, for the generated docs */
  summary: string;
  /** What its endpoint answers with, for the generated docs */
  returns: string;
  /** Keys of this type only */
  properties: Record<string, z.ZodType>;
  /** The methods its request may use */
  methods: readonly HttpMethod[];
  /** Where its params may go, besides the path */
  locations: readonly ParamLocation[];
  /** Query param names the host adds to its request */
  reservedQueryNames: readonly string[];
}

export const BUILT_IN_TYPES = {
  markdown: {
    summary: "Prose, generated commentary, formatted text",
    returns: "A markdown string, as text or as JSON with the string at `data.dataKey`",
    properties: {},
    methods: HTTP_METHODS,
    locations: PARAM_LOCATIONS,
    reservedQueryNames: ["theme"],
  },
  html: {
    summary: "A report, page or visualization the backend renders itself",
    returns: "An HTML document as text",
    properties: {
      raw: z
        .boolean()
        .meta({
          description:
            "The endpoint also answers `raw=true` with the rows the page was made from, as JSON",
        })
        .optional(),
    },
    methods: HTTP_METHODS,
    locations: PARAM_LOCATIONS,
    reservedQueryNames: ["theme", "raw"],
  },
  newsfeed: {
    summary: "Articles and updates, each with a title, an excerpt and a full text",
    returns: "A JSON array of articles, or JSON with the array at `data.dataKey`",
    properties: {},
    methods: HTTP_METHODS,
    locations: PARAM_LOCATIONS,
    reservedQueryNames: [],
  },
  pdf: {
    summary: "A document the user reads page by page",
    returns:
      "The PDF (`application/pdf`), or JSON with its `data_format` and a base64 `content` or a `url`",
    properties: {},
    methods: HTTP_METHODS,
    locations: PARAM_LOCATIONS,
    reservedQueryNames: [],
  },
  // The endpoint is a page the browser navigates to: GET, and params in the query. The
  // host adds the theme to its query
  iframe: {
    summary: "An existing web page",
    returns: "Nothing: the endpoint is the page's URL, which the browser opens",
    properties: {
      // An MCP server of the page's own, connected for the instance without the
      // backend's credentials
      storage: z
        .strictObject({
          mcpUrl: z
            .string()
            .max(LIMITS.endpoint)
            .regex(/^https?:\/\/\S+$/)
            .meta({ description: "an http or https URL" })
            .optional(),
        })
        .meta({
          description:
            "`mcpUrl`: an MCP server of the page's own, connected for the widget without the backend's credentials",
        })
        .optional(),
    },
    methods: ["GET"],
    locations: ["query"],
    reservedQueryNames: ["theme"],
  },
} as const satisfies Record<string, BuiltInTypeContract>;

/**
 * What a plugin-handled type allows: everything; its `data.<type>` is the plugin's. The
 * host adds the theme to its query, so the endpoint answers for the dark or light site.
 */
export const PLUGIN_TYPE_RULES = {
  methods: HTTP_METHODS,
  locations: PARAM_LOCATIONS,
  reservedQueryNames: ["theme"] as readonly string[],
} as const;
