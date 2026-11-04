import { render, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AuthRedirect from "~/components/LayoutAuth/AuthRedirect";

const restoreSession = vi.fn<() => Promise<boolean>>();
const authState = {
  user: { uuid: "user-1" } as { uuid: string } | null,
  restoreSession,
};

vi.mock("~/lib/state/auth", () => ({
  useShallowAuthStore: (cb: (state: typeof authState) => unknown) => cb(authState),
}));

function renderAt(initialEntry: string) {
  const router = createMemoryRouter(
    [
      { path: "/app/:id", element: <AuthRedirect /> },
      { path: "/login", element: <div>login</div> },
    ],
    { initialEntries: [initialEntry] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe("AuthRedirect", () => {
  beforeEach(() => {
    authState.user = { uuid: "user-1" };
    restoreSession.mockReset();
  });

  it("leaves a signed-in user where they are", async () => {
    const router = renderAt("/app/dash-1?tab=overview");

    await waitFor(() => expect(router.state.location.pathname).toBe("/app/dash-1"));

    expect(router.state.location.search).toBe("?tab=overview");
    expect(restoreSession).not.toHaveBeenCalled();
  });

  it("keeps the page when the session cookie still holds a session", async () => {
    authState.user = null;
    restoreSession.mockResolvedValue(true);
    const router = renderAt("/app/dash-1");

    await waitFor(() => expect(restoreSession).toHaveBeenCalledTimes(1));
    await Promise.resolve();

    expect(router.state.location.pathname).toBe("/app/dash-1");
  });

  it("replaces the page with the login page when there is no session", async () => {
    authState.user = null;
    restoreSession.mockResolvedValue(false);
    const router = renderAt("/app/dash-1");

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));

    expect(router.state.historyAction).toBe("REPLACE");
  });
});
