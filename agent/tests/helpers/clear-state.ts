import { keepChatDataIn } from "../../src/agent/row-cache.ts";
import { bodyBudget } from "../../src/lib/body-budget.ts";
import { createLocalStore } from "../../src/lib/store.ts";
import { clearMcpToolCache } from "../../src/mcp/schema.ts";

export function clearAllModuleState(): void {
  keepChatDataIn(createLocalStore());
  bodyBudget.reset();
  clearMcpToolCache();
}
