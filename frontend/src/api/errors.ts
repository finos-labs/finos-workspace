import type { Login2FAResponse } from "~/types/auth.type";

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

export function loginFailure(error: unknown): Login2FAResponse {
  const { status, data } = getErrorResponse(error);
  const { message, detail, ...rest } = data;
  return { ...rest, detail: String(message || detail || ""), status: status || 500 };
}
