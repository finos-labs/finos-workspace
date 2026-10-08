/**
 * Runtime Config Test Mock
 *
 * Provides a mutable config object for tests. Components that call getConfig()
 * at module level will read from this shared reference, so mutations take effect
 * immediately without needing module re-imports.
 *
 * Usage:
 *   import { mockConfig } from "tests/mocks/runtimeConfig";
 *   // in beforeEach or per-test:
 *   mockConfig.ui.showChangelog = false;
 */
import { vi } from "vitest";
import { RuntimeConfigSchema } from "~/lib/runtimeConfigSchema";

export const mockConfig = RuntimeConfigSchema.parse({
  urls: { backend: "http://localhost:3000", ai: "http://localhost:3000/ai" },
  authentication: {},
  authProviders: {},
  copilot: { enabled: true, saveSkillFromChat: true },
  ui: {},
  data: {},
  links: {},
  contact: {},
  whiteLabel: {},
});

vi.mock("~/lib/runtimeConfig", () => ({
  getConfig: () => mockConfig,
  _resetConfig: vi.fn(),
}));
