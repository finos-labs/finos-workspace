import transformData from "./fetcher/transform";
import ExcelError from "./fetcher/errors";
import { privateFunc } from "./fetcher/utils";
import { sliceArray } from "./slicer";
import {
  createWidgetRequest,
  fetchWidgetRequest,
  getCustomBackend,
  getWidgetDefinition,
} from "~/functions/custom.api";
import { RawCell } from "~/types/excel.types";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Get the data from a widget living in a backend.
 * @customfunction WIDGET
 * @param backend Name of the backend.
 * @param widget Name or ID of the widget to get data for.
 * @param [parameters] Widget parameters as (n rows by 2 columns) range selection or array constant (e.g. {"key1","value1"}; {"key2","value2"}).
 * @returns Widget data.
 */
export async function widget(
  backend: string,
  widget: string,
  parameters?: any[][],
): Promise<any[][]> {
  try {
    privateFunc();

    const customBackend = getCustomBackend(backend);
    const widgetDefinition = await getWidgetDefinition(customBackend, widget);
    const request = createWidgetRequest(
      customBackend,
      widgetDefinition,
      parameters || ([] as RawCell[][]),
    );
    const result = await fetchWidgetRequest(request);

    let data: any;
    if (request.dataKey) data = result[request.dataKey];
    else data = result;
    return transformData(data);
  } catch (e) {
    return ExcelError(e);
  }
}
CustomFunctions.associate("WIDGET", widget);

/**
 * Slice data from a range.
 * @customfunction GET
 * @param array Array to slice.
 * @param [rows] Range of row labels or indices.
 * @param [columns] Range of column labels or indices.
 * @returns Sliced array.
 */
export async function get(
  array: any[][],
  rows: any[][],
  columns: any[][],
): Promise<any[][]> {
  try {
    privateFunc();
    return sliceArray(array, rows, columns);
  } catch (e) {
    return ExcelError(e);
  }
}
CustomFunctions.associate("GET", get);
