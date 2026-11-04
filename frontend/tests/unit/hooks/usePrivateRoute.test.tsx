import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateUser } from "~/api/auth.api";
import { usePrivateRoute } from "~/hooks/usePrivateRoute";
import { useAuthStore } from "~/lib/state/auth";
import { makeAuthUser } from "../factories";
import { partial } from "../mocks";

vi.mock("~/api/auth.api", () => ({ validateUser: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter initialEntries={["/app/dash-1"]}>{children}</MemoryRouter>
);

function renderPrivateRoute(shouldValidate?: boolean) {
  return renderHook(
    () => {
      usePrivateRoute(shouldValidate);
      return useLocation().pathname;
    },
    { wrapper },
  );
}

describe("usePrivateRoute", () => {
  const mockLogout = vi.fn();
  const mockRestoreSession = vi.fn<() => Promise<boolean>>();

  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: null,
      logout: mockLogout,
      restoreSession: mockRestoreSession,
    });
  });

  describe("with nobody in memory (a reload)", () => {
    it("restores the session from the cookie and stays", async () => {
      mockRestoreSession.mockResolvedValue(true);

      const { result } = renderPrivateRoute();

      await waitFor(() => expect(mockRestoreSession).toHaveBeenCalledTimes(1));
      expect(result.current).toBe("/app/dash-1");
      expect(mockLogout).not.toHaveBeenCalled();
      expect(validateUser).not.toHaveBeenCalled();
    });

    it("goes to the login page without asking the API to end a session", async () => {
      mockRestoreSession.mockResolvedValue(false);

      const { result } = renderPrivateRoute();

      await waitFor(() => expect(result.current).toBe("/login"));
      expect(mockLogout).not.toHaveBeenCalled();
    });
  });

  describe("with a signed-in user", () => {
    beforeEach(() => {
      useAuthStore.setState({ user: makeAuthUser() });
    });

    it("validates the session by default", async () => {
      vi.mocked(validateUser).mockResolvedValue(partial({ success: true }));

      renderPrivateRoute();

      await waitFor(() => expect(validateUser).toHaveBeenCalled());
      expect(mockLogout).not.toHaveBeenCalled();
      expect(mockRestoreSession).not.toHaveBeenCalled();
    });

    it("does not validate when asked not to", () => {
      renderPrivateRoute(false);

      expect(validateUser).not.toHaveBeenCalled();
    });

    it("signs out when the session is no longer valid", async () => {
      vi.mocked(validateUser).mockResolvedValue(partial({ success: false }));

      renderPrivateRoute(true);

      await waitFor(() => expect(mockLogout).toHaveBeenCalled());
    });

    it("signs out when validation fails", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(validateUser).mockRejectedValue(new Error("Network error"));

      renderPrivateRoute(true);

      await waitFor(() => expect(mockLogout).toHaveBeenCalled());
    });
  });
});
