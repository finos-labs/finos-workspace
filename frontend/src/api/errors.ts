import type { Login2FAResponse } from "~/types/auth.type";

/** What a failed request came back with, if the error carries a response. */
export function getErrorResponse(error: unknown): {
  status?: number;
  data: Record<string, unknown>;
} {
  const response =
    typeof error === "object" && error !== null && "response" in error
      ? (error as { response?: { status?: number; data?: unknown } }).response
      : undefined;
  return {
    status: response?.status,
    data: (response?.data as Record<string, unknown> | undefined) ?? {},
  };
}

/** What a failed request says went wrong, in words the user can read. */
export function errorMessage(error: unknown, fallback: string): string {
  const { data } = getErrorResponse(error);
  const { detail, message } = data;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => (typeof item === "object" && item !== null ? item.msg : item))
      .filter((text): text is string => typeof text === "string");
    if (messages.length > 0) return messages.join(", ");
  }
  return String(detail || message || fallback);
}

/** The result of a failed login request: what the server said, or a 500 if it never answered. */
export function loginFailure(error: unknown): Login2FAResponse {
  const { status, data } = getErrorResponse(error);
  const { message, detail, ...rest } = data;
  return { ...rest, detail: String(message || detail || ""), status: status || 500 };
}
