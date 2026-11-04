import { vi } from "vitest";

vi.mock("~/api/api", () => ({
  setOnSessionRefused: vi.fn(),
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    put: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  },
}));

vi.mock("~/queryClient", () => ({
  default: { invalidateQueries: vi.fn(), refetchQueries: vi.fn() },
}));
