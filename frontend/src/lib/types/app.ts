import { z } from "zod";
import type { FormInputParamDef, ParamDef } from "~/components/types";
import { PLUGIN_ID_PATTERN } from "~/plugins/types";
import {
  EditorLanguages,
  HTTP_METHODS,
  PARAM_LOCATIONS,
  VIZ_TYPE_PATTERN,
} from "./widgetsContract";

function unionErrorMap(message: string) {
  return {
    error: (val) => {
      const output = { message: val.message };
      if (val.code === "invalid_union" || val.code === "invalid_value") {
        output.message = message;
      }
      return output;
    },
  } as { error: z.core.$ZodErrorMap };
}

export const _GridDataSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  minH: z.number().nullish(),
  minW: z.number().nullish(),
  maxH: z.number().nullish(),
  maxW: z.number().nullish(),
  moved: z.boolean().nullish(),
  static: z.boolean().nullish(),
  isDraggable: z.boolean().nullish(),
});

export const StorageSchema = z.looseObject({}).default({});

export const CronExpressionSchema = z.string().trim().min(1);
export const RefetchIntervalSchema = z.union([
  z.number().min(1000),
  z.literal(false),
  CronExpressionSchema,
]);

export type EditorLanguage = (typeof EditorLanguages)[number];

const ParamDefSchemaBase = z
  .object({
    paramName: z.string().min(1, "This field is required"),
    label: z.string().optional(),
    value: z.unknown().nullish(),
    description: z.unknown().optional(),
    multiple: z.boolean().default(false).optional(),
    row: z.number().optional(),
    type: z
      .enum(
        ["text", "date", "number", "boolean", "endpoint", "button", "tabs"],
        unionErrorMap(
          "Supported types are text, date, number, boolean, endpoint, tabs",
        ),
      )
      .default("text")
      .optional(),
    show: z.boolean().default(true).optional(),
    hidden: z.boolean().optional().default(false),
    style: z
      .object({
        popupWidth: z.number().min(100).max(1000).optional(),
      })
      .optional(),
    options: z
      .array(
        z
          .object({
            label: z.string(),
            value: z.union([z.string(), z.number(), z.boolean(), z.null()]).nullish(),
            extraInfo: z
              .object({
                description: z.string().optional(),
                rightOfDescription: z.string().optional(),
              })
              .optional(),
          })
          .optional(),
      )
      .default([])
      .optional(),
    multiSelect: z.boolean().default(false).optional(),
    roles: z.array(z.string()).optional(),
    placeholder: z.string().optional(),
    in: z.enum(PARAM_LOCATIONS).optional(),
  })
  .partial({
    options: true,
    value: true,
    label: true,
    description: true,
    row: true,
    multiple: true,
    placeholder: true,
    multiSelect: true,
    show: true,
    hidden: true,
  })
  .meta({ id: "ParamDef" });

const OptionsLookup = {
  optionsEndpoint: z.string().optional(),
  optionsMethod: z.enum(HTTP_METHODS).optional(),
  optionsParams: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional(),
};

const ParamValueSchema = z.discriminatedUnion("type", [
  ParamDefSchemaBase.extend({
    type: z.literal("text"),
    value: z.string().nullish(),
    language: z.enum(EditorLanguages, unionErrorMap("Unsupported language")).nullish(),
  }).meta({ id: "TextParamDef" }),
  ParamDefSchemaBase.extend({
    type: z.literal("tabs"),
    value: z.string().nullish(),
    options: z
      .array(
        z.object({
          label: z.string(),
          value: z.string().nullish(),
        }),
      )
      .optional(),
  }).meta({ id: "TabsParamDef" }),
  ParamDefSchemaBase.extend({
    type: z.literal("date"),
    value: z.string().nullish(),
  }).meta({ id: "DateParamDef" }),
  ParamDefSchemaBase.extend({
    type: z.literal("button"),
    label: z.string().optional(),
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]).nullish(),
  }).meta({ id: "ButtonParamDef" }),
  ParamDefSchemaBase.extend({
    type: z.literal("number"),
    value: z
      .union([z.number(), z.string().regex(/^-?\d*\.?\d*$/)])
      .pipe(z.coerce.number())
      .nullish(),
  }).meta({ id: "NumberParamDef" }),
  ParamDefSchemaBase.extend({
    type: z.literal("boolean"),
    value: z.boolean().nullish(),
  }).meta({ id: "BooleanParamDef" }),
  ParamDefSchemaBase.extend({
    type: z.literal("endpoint"),
    value: z.unknown().nullish(),
    ...OptionsLookup,
    groupById: z.string().optional(),
  }).meta({ id: "EndpointParamDef" }),
  ParamDefSchemaBase.extend({
    paramName: z.string().optional(),
    type: z.literal("form"),
    endpoint: z.string().optional(),
    method: z.enum(["POST", "PUT"]).optional(),
    inputParams: z
      .array(
        ParamDefSchemaBase.extend({
          type: z
            .enum(
              ["date", "boolean", "endpoint", "number", "text", "button"],
              unionErrorMap(
                "Supported types are text, date, button, number, boolean, endpoint",
              ),
            )
            .optional(),
          ...OptionsLookup,
        }),
      )
      .optional(),
  }).meta({ id: "FormParamDef" }),
]);

export const ParamDefSchema = ParamValueSchema.refine(
  (data) => {
    if (data.multiple === true && data.type !== "text") {
      return false;
    }
    return true;
  },
  {
    message: "multiple can only be true when type is 'text'",
    path: ["multiple"],
  },
);

const ParamDefSchemaArray = z.array(ParamDefSchema).refine(
  (params) => {
    const fileSelectorCount = params.filter((param) =>
      param.roles?.includes("fileSelector"),
    ).length;
    return fileSelectorCount <= 1;
  },
  {
    message: "Only one parameter can have the role 'fileSelector'.",
  },
);

const toParamType: Record<string, ParamDef["type"]> = { date: "date" };

export function newParamDef<T extends ParamDef | FormInputParamDef>(paramDef: T): T {
  const { type, value, show } = paramDef;
  const declaredType: string | undefined = type;
  let options = paramDef.options ?? [];

  if (type === "boolean" && !options.length) {
    options = [
      { label: "True", value: true },
      { label: "False", value: false },
    ];
  }

  const parseValue = (v: unknown) => {
    if (!v) return undefined;
    if (type === "number" && typeof v === "string") {
      for (const fnc of [Number.parseFloat, Number.parseInt]) {
        const num = fnc(v);
        if (!Number.isNaN(num)) return num;
      }
    }
    if (type === "text") return String(v);
    return v;
  };

  const parsedValue = parseValue(value);

  return {
    ...paramDef,
    value: parsedValue ?? null,
    label: paramDef.label ?? paramDef.paramName,
    type: declaredType ?? toParamType[paramDef.paramName] ?? "text",
    show: typeof show === "boolean" ? show : true,
    options,
  };
}

export function isParamDef(p: unknown): p is ParamDef {
  if (typeof p !== "object" || p === null) return false;
  return ("type" in p && p.type === "form") || ("paramName" in p && !!p.paramName);
}

export function isParamDefArray(params: unknown): params is ParamDef[] {
  return Array.isArray(params) && params.every((p) => isParamDef(p));
}

export const ParamsSchema = z
  .preprocess((val) => {
    if (!Array.isArray(val)) return [];

    const values = val.map((item) => (isParamDef(item) ? newParamDef(item) : item));

    let row = isParamDef(values[0]) ? 1 : 0;
    for (const item of values) {
      if (isParamDefArray(item)) {
        for (const p of item) {
          if (!isParamDef(p)) continue;

          Object.assign(p, newParamDef(p));
          p.row = row;
        }
        row++;
        continue;
      }

      if (isParamDef(item) && item.row === undefined) {
        item.row = 0;
      }
    }

    return values.flat();
  }, ParamDefSchemaArray)
  .default([]);

export const WidgetVizTypes = [
  "html",
  "iframe",
  "markdown",
  "newsfeed",
  "pdf",
] as const;

const supportedTypesError = WidgetVizTypes.filter((v) => v !== "iframe")
  .map((v) => `\`${v}\``)
  .join(", ");

export type PluginVizType = string & { readonly __pluginVizType?: never };
export type BuiltInVizType = (typeof WidgetVizTypes)[number];
export type WidgetVizType = BuiltInVizType | "custom" | PluginVizType;

export const widgetTypesSchema = z
  .string()
  .regex(
    VIZ_TYPE_PATTERN,
    `A widget type is a lowercase name. Built-in types are ${supportedTypesError}; widget plugins add others.`,
  )
  .nullish()
  .meta({ id: "WidgetType" });

export const WidgetStateSchema = z
  .looseObject({
    paramOrder: z.array(z.string()).optional(),
    params: z.record(z.string(), z.unknown()).optional(),
    storage: z
      .looseObject({
        text: z.string().optional(),
        html: z.string().optional(),
        plugin: z
          .strictObject({ config: z.record(z.string(), z.unknown()).optional() })
          .optional(),
      })
      .optional(),
  })
  .meta({ id: "WidgetState" });

export const TemplateLayoutItemSchema = z
  .looseObject({
    i: z.string(),
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
    minW: z.number().optional(),
    minH: z.number().optional(),
    maxW: z.number().optional(),
    maxH: z.number().optional(),
    moved: z.boolean().optional(),
    static: z.boolean().optional(),
    isDraggable: z.boolean().optional(),
    state: WidgetStateSchema.optional(),
    groups: z.array(z.string()).optional(),
  })
  .meta({ id: "Layout" });

const templateShapeDefinition = {
  templateId: z.string().optional(),
  id: z
    .string()
    .regex(/^custom-.+/)
    .optional(),
  name: z.string(),
  description: z.string().optional(),
  selected_agent: z.string().optional(),
  img: z.string().optional(),
  img_dark: z.string().optional(),
  img_light: z.string().optional(),
  authentication: z.string().optional(),
  tabs: z
    .record(
      z.string(),
      z.object({
        id: z.string(),
        name: z.string(),
        layout: z.array(TemplateLayoutItemSchema),
      }),
    )
    .meta({ id: "Tabs" }),
  groups: z
    .array(
      z
        .object({
          name: z.string(),
          paramName: z.string().optional(),
          type: z.enum(["param", "endpointParam"]),
          widgetIds: z.array(z.string()).optional(),
          defaultValue: z.unknown().nullish(),
        })
        .meta({ id: "Group" }),
    )
    .default([])
    .optional(),
  prompts: z.array(z.string()).optional(),
  mcpServers: z
    .array(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        url: z.url(),
        authType: z.enum(["oauth", "token"]).optional(),
      }),
    )
    .optional(),
  allowCustomization: z.boolean().optional(),
};

export const backendTemplateSchema = z
  .object(templateShapeDefinition)
  .transform((val) => {
    if (val.groups?.find((g) => g.widgetIds !== undefined)) {
      val.tabs = Object.fromEntries(
        Object.entries(val.tabs).map(([key, tab]) => [
          key,
          {
            ...tab,
            layout: tab.layout.map((layout) => ({
              ...layout,
              groups:
                layout.groups ??
                (val.groups ?? [])
                  .filter((g) => g.widgetIds?.includes(layout.i))
                  .map((g) => g.name),
            })),
          },
        ]),
      );
    }
    return val;
  });

export const templateSpecificationSchema = z.array(
  z.object(templateShapeDefinition).meta({ id: "AppsJson" }),
);

export const KNOWN_TEMPLATE_KEYS = new Set(Object.keys(templateShapeDefinition));

export const WidgetSchemaBase = z.object({
  id: z.string(),
  widgetId: z.string(),
  type: widgetTypesSchema.optional(),
  name: z.string().optional(),
  showTitle: z.boolean().default(true).nullish(),
  description: z.string().optional(),
  groupById: z.string().nullish(),
  innerTab: z.string().optional(),
  disableRetrievalForCopilot: z.boolean().optional(),
  storage: StorageSchema.optional(),
  external: z.boolean().optional(),
  params: ParamsSchema.optional(),
  staleTime: z
    .number()
    .min(1000)
    .nullish()
    .default(1000 * 60 * 5),
  refetchInterval: RefetchIntervalSchema.nullish(),
  dataUpdateDisplay: CronExpressionSchema.optional(),
  runButton: z.boolean().optional(),
  raw: z.boolean().optional(),
  requires_auth: z.boolean().optional(),
  exportable: z.boolean().default(true).optional(),
});

export const InternalWidgetSchema = WidgetSchemaBase.extend({
  plugin: z
    .strictObject({
      id: z.string().regex(PLUGIN_ID_PATTERN),
      widget: z.string().max(48),
    })
    .optional(),
  data: z
    .object({
      html: z.string().optional(),
    })
    .optional()
    .default({}),
  refetchInterval: z
    .union([z.number().min(1000), z.literal(false), CronExpressionSchema])
    .optional()
    .default(1000 * 60 * 15),
});

export const ExternalWidgetSchema = WidgetSchemaBase.extend({
  category: z.string().nullish(),
  subCategory: z.string().nullish(),
  connectionType: z.enum(["advanced-backend", "file", "widgetMetadata"]).nullish(),
  endpoint: z
    .object({
      url: z.string(),
      method: z.enum(["GET", "POST"]),
    })
    .optional(),
  data: z.looseObject({}).optional().default({}),
  source: z.union([z.array(z.string()), z.string()]).nullish(),
  sourceId: z.string().nullish(),
  sourceName: z.string().nullish(),
  isSharedWidget: z.boolean().nullish(),
}).transform((val) => {
  if ((val.runButton && !val.refetchInterval) || val.refetchInterval === false) {
    val.staleTime = Number.POSITIVE_INFINITY;
    val.refetchInterval = false;
  } else if (!val.runButton && val.refetchInterval === undefined) {
    val.refetchInterval = 1000 * 60 * 15;
  }
  return val;
});

export function isBuiltInVizType(
  type: string | null | undefined,
): type is BuiltInVizType {
  return WidgetVizTypes.some((vizType) => vizType === type);
}

export function isWellFormedVizType(
  type: string | null | undefined,
): type is WidgetVizType {
  return typeof type === "string" && VIZ_TYPE_PATTERN.test(type);
}

export function isRenderableVizType(
  type: string | null | undefined,
  pluginTypes: ReadonlySet<string> = new Set(),
): type is WidgetVizType {
  return isBuiltInVizType(type) || (typeof type === "string" && pluginTypes.has(type));
}
