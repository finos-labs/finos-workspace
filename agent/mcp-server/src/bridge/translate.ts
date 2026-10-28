export interface WidgetDataRequestInput {
  origin: string;
  widget_id: string;
  data_args: Record<string, unknown>;
  widget_uuid?: string | null;
}

export interface ParamOptionsRequestInput {
  origin: string;
  widget_id: string;
  param_name: string;
  data_args: Record<string, unknown>;
}

export function dataSourcePayloads(
  items: WidgetDataRequestInput[],
): Array<Record<string, unknown>> {
  return items.map((item) => ({
    origin: item.origin,
    id: item.widget_id,
    input_args: item.data_args,
    widget_uuid: item.widget_uuid ?? null,
  }));
}

export function paramOptionsPayloads(
  items: ParamOptionsRequestInput[],
): Array<Record<string, unknown>> {
  return items.map((item) => ({
    origin: item.origin,
    id: item.widget_id,
    param: item.param_name,
    options_endpoint_input_args: item.data_args,
  }));
}
