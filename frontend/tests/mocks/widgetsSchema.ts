import { setDefaultWidgetsSchema } from "~/lib/utils/validateBackend";
import type { ComposedWidgetsSchema } from "~/lib/utils/widgetsSchemaValidation";
import composed from "./widgets-schema.json";

export const widgetsSchema = composed as unknown as ComposedWidgetsSchema;

export function installWidgetsSchemaFixture() {
  setDefaultWidgetsSchema(widgetsSchema);
}
