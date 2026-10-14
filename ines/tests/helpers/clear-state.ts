/**
 * Clears all module-level state that test files might share when running
 * inside a single bun test process. Call from `beforeEach` for any test
 * that touches the agent loop or row cache.
 */

import { _resetWidgetDataCache } from "../../src/agent/loop";

export function clearAllModuleState(): void {
  _resetWidgetDataCache();
  (globalThis as { __ines_chat_row_cache?: Map<string, unknown> })
    .__ines_chat_row_cache?.clear();
}
