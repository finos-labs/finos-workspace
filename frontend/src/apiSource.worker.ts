import { debounce } from "lodash";
import {
  errorResponse,
  getApiSourceWidgets,
  processWorkerResults,
} from "~/lib/utils/validateBackend";
import type { Source, ValidateBackend } from "./lib/state/backendConnector";

interface EventData {
  apiSources: Source[];
  extraHeaders?: Record<string, string>;
}

type ResultT = { source: Source; result: ValidateBackend };

const debouncedPartialResults = debounce(
  (data: ResultT[]) => {
    // Send partial results with __partial flag
    self.postMessage(processWorkerResults(data, true));
  },
  500,
  { maxWait: 800, trailing: true },
);

self.onmessage = async (e: MessageEvent<EventData>) => {
  // Only the page that started the worker posts to it, which names no other origin
  if (e.origin && e.origin !== self.location.origin) return;
  const { apiSources, extraHeaders } = e.data;

  const results: ResultT[] = [];
  const sliceSize = Math.ceil(apiSources.length / 5); // Adjust the slice size as needed

  const promises = apiSources.map(async (source) => {
    let entry: ResultT;
    try {
      const result = await getApiSourceWidgets(source, { extraHeaders });
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
  debouncedPartialResults.cancel(); // Cancel any pending partial results
  self.postMessage(processWorkerResults(finalResults));
};
