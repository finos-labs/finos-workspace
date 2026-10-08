import excelDateToString, {
  currentDateModifier,
} from "~/functions/fetcher/dates.ts";
import { CFError, handleErrors } from "~/functions/fetcher/errors.ts";
import { isEmpty, processEndpointHeaders } from "~/functions/fetcher/utils.ts";
import { useAuthStore } from "~/store/auth";
import { useCustomBackendsStore } from "~/store/custom.backends";
import { RawCell } from "~/types/excel.types.ts";
import { Backend } from "~/types/user.types.ts";
import {
  WidgetDefinition,
  WidgetId,
  WidgetRequest,
} from "~/types/widget.types.ts";

export function getCustomBackend(backend: string): Backend {
  const { user } = useAuthStore.getState();
  const customBackend = user?.profile?.api_sources.find(
    // The name is case-sensitive, the url is not
    (b) => b.name === backend || b.url.toLowerCase() === backend.toLowerCase(),
  );
  if (isEmpty(customBackend)) throw CFError("Backend not found.");
  return customBackend!;
}

export async function getWidgetDefinition(
  backend: Backend,
  widgetIdOrName: string,
): Promise<WidgetDefinition> {
  const customBackendsStore = useCustomBackendsStore.getState();
  let widgetDefinitionMap: Record<WidgetId, WidgetDefinition> | undefined = {};
  widgetDefinitionMap = customBackendsStore.getBackendWidgets(backend.id)
  if (isEmpty(widgetDefinitionMap)) {
    try {
      widgetDefinitionMap = await getWidgetDefinitionMap(backend!);
      if (isEmpty(widgetDefinitionMap)) throw CFError("Widget not found.");
      customBackendsStore.update({ [backend.id]: widgetDefinitionMap });
    } catch (e) {
      throw CFError(`Error connecting to backend.`);
    }
  }
  if (isEmpty(widgetDefinitionMap)) throw CFError("Widget not found.");

  let widgetDefinition: WidgetDefinition | undefined;
  // First we try by ID
  widgetDefinition = (widgetDefinitionMap!)[widgetIdOrName];
  // Then we try by name
  if (!widgetDefinition) {
    const widgetId = customBackendsStore.getWidgetIdFromName(backend.id, widgetIdOrName);
    if (widgetId) widgetDefinition = widgetDefinitionMap![widgetId];
  }
  if (isEmpty(widgetDefinition)) throw CFError("Widget not found.");
  return widgetDefinition!;
}

export async function getWidgetDefinitionMap(
  backend: Backend,
): Promise<Record<string, WidgetDefinition>> {
  const { headers, query: fixedQueryParams } = processEndpointHeaders(
    backend.endpointHeaders,
  );
  const searchParams = new URLSearchParams({ ...fixedQueryParams });
  const urlParams = searchParams.toString();
  const url = backend.url + (urlParams ? `?${urlParams}` : "");
  const widgetJsonUrl = url + "/widgets.json";
  console.log("[Fetch] GET", widgetJsonUrl);
  const response = await fetch(widgetJsonUrl, { headers });
  if (!response.ok) throw new Error(`Error connecting to ${widgetJsonUrl}.`);
  const widgetsJson = await response.json();
  return widgetsJson;
}

function trimRawCell(cell: RawCell): RawCell {
  return typeof cell === "string" ? cell.trim() : cell;
}

export function createWidgetRequest(
  backend: Backend,
  widgetDefinition: WidgetDefinition,
  parameters: RawCell[][],
): WidgetRequest {
  // For now, we only support GET method
  const method = "GET";
  // Process the parameters from the widget
  const widgetParams = (widgetDefinition.params ?? []).reduce(
    (acc, param) => {
      acc[param.paramName] = {
        default: param.value,
        type: param.type,
        mutable: param.show === true || param.show === undefined,
      };
      return acc;
    },
    {} as Record<
      string,
      {
        default: string | number | boolean | undefined;
        type: string;
        mutable: boolean;
      }
    >,
  );
  // Update the widget params with the parameters passed by the user
  const finalParams = Object.entries(widgetParams).reduce(
    (acc, [name, spec]) => {
      if (spec.mutable) {
        const userInput = parameters.find((p) => trimRawCell(p[0]) === name);
        let value: RawCell | undefined;
        if (userInput)
          value =
            spec.type === "date"
              ? excelDateToString(userInput[1] as string)
              : userInput[1];
        else if (spec.type === "date" && spec.default)
          value = currentDateModifier(spec.default as string);
        else value = spec.default;
        if (value != null && value !== undefined) acc[name] = value;
      } else {
        // For non-mutable parameters, we use the default value
        if (spec.default != null && spec.default !== undefined)
          acc[name] = spec.default;
      }
      return acc;
    },
    {} as Record<string, RawCell>,
  );

  const { headers, query: fixedQueryParams } = processEndpointHeaders(
    backend.endpointHeaders,
  );
  let urlParams = "";
  switch (method) {
    case "GET": {
      const searchParams = new URLSearchParams({
        ...finalParams,
        ...fixedQueryParams,
      });
      urlParams = searchParams.toString();
      break;
    }
    default:
      throw CFError(`Request method '${method}' not supported.`);
  }
  // Some endpoints have a leading slash we need to remove
  const url = `${backend!.url}/${widgetDefinition.endpoint.replace(
    /^\/?/,
    "",
  )}`;
  return {
    url: url + (urlParams ? `?${urlParams}` : ""),
    method: method,
    headers: headers,
    dataKey: widgetDefinition.data?.dataKey,
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function fetchWidgetRequest(request: WidgetRequest): Promise<any> {
  const { url, method, headers, body } = request;
  console.log("[Fetch]", `method=${method} url=${url} body=${body}`); //? debug

  const myRequest = new Request(url, {
    method: method,
    headers: headers,
    body: body,
  });

  const response = await fetch(myRequest);
  if (!response.ok) {
    const errorResponse = await response.json();
    handleErrors(errorResponse);
  }
  return await response.json();
}
