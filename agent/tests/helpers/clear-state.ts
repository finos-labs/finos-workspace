/**
 * Clears all module-level state that the tests of a file share (node --test
 * runs each file in a process of its own). Call from `beforeEach` for any test
 * that touches the agent loop or a chat's kept rows and widget data: each
 * test gets an empty store.
 */

import { keepChatDataIn } from "../../src/agent/row-cache.ts";
import { createLocalStore } from "../../src/lib/store.ts";

export function clearAllModuleState(): void {
  keepChatDataIn(createLocalStore());
}
