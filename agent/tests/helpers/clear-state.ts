/**
 * Clears all module-level state that test files might share when running
 * inside a single bun test process. Call from `beforeEach` for any test
 * that touches the agent loop or a chat's kept rows and widget data: each
 * test gets an empty store.
 */

import { keepChatDataIn } from "../../src/agent/row-cache";
import { createLocalStore } from "../../src/lib/store";

export function clearAllModuleState(): void {
  keepChatDataIn(createLocalStore());
}
