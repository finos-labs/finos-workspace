import { vi } from "vitest";

vi.mock("~/lib/constants", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/constants")>();
  return {
    ...actual,
    VERSION: "test-version",
  };
});
