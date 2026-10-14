import { setDefaultWidgetsSchema } from "~/lib/utils/validateBackend";
import type { ComposedWidgetsSchema } from "~/lib/utils/widgetsSchemaValidation";
import composed from "./widgets-schema.json";

/**
 * The widgets.json schema the API composes for the built-in types and a test plugin type
 * (`test_chart`); `backend-api/backend/tests/test_widgets_schema.py` keeps it current.
 */
export const widgetsSchema = composed as unknown as ComposedWidgetsSchema;

/** Backends in the test validate against the fixture, as against the API's schema. */
export function installWidgetsSchemaFixture() {
  setDefaultWidgetsSchema(widgetsSchema);
}
