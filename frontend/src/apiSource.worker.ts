import { debounce } from "lodash";
import {
  errorResponse,
  getApiSourceWidgets,
  processWorkerResults,
} from "~/lib/utils/validateBackend";
import type { Source, ValidateBackend } from "./lib/state/backendConnector";
import type { ComposedWidgetsSchema } from "./lib/utils/widgetsSchemaValidation";

interface EventData {
  apiSources: Source[];
  extraHeaders?: Record<string, string>;
  pluginVizTypes?: string[];
  widgetsSchema: ComposedWidgetsSchema;
}

type ResultT = { source: Source; result: ValidateBackend };

const debouncedPartialResults = debounce(
  (data: ResultT[]) => {
    self.postMessage(processWorkerResults(data, true));
  },
  500,
  { maxWait: 800, trailing: true },
);

self.onmessage = async (e: MessageEvent<EventData>) => {
  if (e.origin && e.origin !== self.location.origin) return;
  const { apiSources, extraHeaders, pluginVizTypes = [], widgetsSchema } = e.data;

  const results: ResultT[] = [];
  const sliceSize = Math.ceil(apiSources.length / 5);

  const promises = apiSources.map(async (source) => {
    let entry: ResultT;
    try {
      const result = await getApiSourceWidgets(source, {
        extraHeaders,
        pluginVizTypes,
        widgetsSchema,
      });
      entry = { source, result };
    } catch (error) {
      console.error("Error processing backend in worker:", error);
      const result: ValidateBackend = {
        ...errorResponse,
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      };
      entry = { source, result };
    }
    results.push(entry);

    if (results.length % sliceSize === 0) debouncedPartialResults(results.slice());

    return entry;
  });

  const finalResults = await Promise.all(promises);
  debouncedPartialResults.cancel();
  self.postMessage(processWorkerResults(finalResults));
};
