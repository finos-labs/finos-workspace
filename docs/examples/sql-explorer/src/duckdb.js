import { AsyncDuckDB, getPlatformFeatures, VoidLogger } from "@duckdb/duckdb-wasm";
import { completerFor, EXTENSIONS } from "./completion.js";

export const WASM_ASSET = "assets/duckdb-eh.wasm";
export const WORKER_ASSET = "assets/duckdb-browser-eh.worker.js";
export const extensionAsset = (name) => `assets/${name}.duckdb_extension.wasm`;

export function bootstrap(workerUrl, extensionUrls) {
  return [
    `const packaged = ${JSON.stringify(extensionUrls)};`,
    "self.runtime = {",
    '  whereToLoad: (name) => packaged[String(name).split("/").pop().split(".")[0]] ?? "",',
    "};",
    `importScripts(${JSON.stringify(workerUrl)});`,
  ].join("\n");
}

export async function startCompleter(readAsset) {
  const features = await getPlatformFeatures();
  if (!features.wasmExceptions) throw new Error("this browser has no WebAssembly exceptions");
  const [wasm, worker, ...extensions] = await Promise.all(
    [WASM_ASSET, WORKER_ASSET, ...EXTENSIONS.map(extensionAsset)].map(readAsset),
  );
  const urls = [];
  const blobUrl = (bytes, type) => {
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    urls.push(url);
    return url;
  };
  const wasmUrl = blobUrl(wasm, "application/wasm");
  const extensionUrls = Object.fromEntries(
    EXTENSIONS.map((name, i) => [name, `${blobUrl(extensions[i], "application/wasm")}#/${name}.duckdb_extension.wasm`]),
  );
  const workerUrl = blobUrl(bootstrap(blobUrl(worker, "text/javascript"), extensionUrls), "text/javascript");
  try {
    const db = new AsyncDuckDB(new VoidLogger(), new Worker(workerUrl));
    await db.instantiate(wasmUrl);
    await db.open({});
    return await completerFor(await db.connect());
  } finally {
    for (const url of urls) URL.revokeObjectURL(url);
  }
}
