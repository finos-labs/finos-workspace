import { keepChatDataIn } from "../../src/agent/row-cache.ts";
import { createLocalStore } from "../../src/lib/store.ts";

export function clearAllModuleState(): void {
  keepChatDataIn(createLocalStore());
}
