import { setupServer } from "msw/node";
import { handlers } from "./handlers";

export const server = setupServer(...handlers);

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
export { handlers };
