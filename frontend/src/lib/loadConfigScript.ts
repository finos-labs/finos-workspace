import { _resetConfig } from "./runtimeConfig";

const CONFIG_SCRIPT = "/config.js";

const importScript = (url: string): Promise<unknown> => import(/* @vite-ignore */ url);

export async function loadConfigScript(
  load: (url: string) => Promise<unknown> = importScript,
): Promise<void> {
  if (import.meta.env.MODE !== "runtime" || typeof window !== "undefined") return;
  Object.assign(globalThis, { window: globalThis });
  try {
    await load(CONFIG_SCRIPT);
  } catch (error) {
    console.error(
      "[runtimeConfig] config.js could not be loaded in the worker:",
      error,
    );
  }
  _resetConfig();
}
