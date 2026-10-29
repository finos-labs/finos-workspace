import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./server";

export function setupMSW() {
  beforeAll(() => server.listen({ onUnhandledRequest: "warn" }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
}

export {
  createErrorHandler,
  createMockHandler,
  mockAccess,
  mockCopilotKeys,
  mockDashboardData,
  mockSession,
  mockUsage,
  mockUser,
  mockValidateResponse,
} from "./handlers";
export { HttpResponse, http, server } from "./server";
