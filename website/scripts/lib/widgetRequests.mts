import type { WidgetRequestData } from "../../src/data/types.ts";
import { readReference } from "./reference.mts";

export function collectWidgetRequests(): WidgetRequestData {
  return readReference("frontend", "widget-request-reference.json") as WidgetRequestData;
}
