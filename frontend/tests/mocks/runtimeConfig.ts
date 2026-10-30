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
  setConfig: vi.fn(),
  _resetConfig: vi.fn(),
}));
