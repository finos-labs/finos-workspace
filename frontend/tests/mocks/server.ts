import { setupServer } from "msw/node";
import { handlers } from "./handlers";

// Create server instance with default handlers
export const server = setupServer(...handlers);

// Re-export useful MSW utilities
export { HttpResponse, http } from "msw";
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
// Export handlers for extending in tests
export { handlers };
