import { AxiosError } from "axios";

export function apiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof AxiosError) {
    const detail = (error.response?.data as { detail?: string } | undefined)?.detail;
    return detail || error.message || fallback;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
