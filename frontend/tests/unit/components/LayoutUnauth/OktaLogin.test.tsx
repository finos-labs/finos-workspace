import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import OktaLogin from "~/components/LayoutUnauth/OktaLogin";

describe("OktaLogin", () => {
  it("starts the sign-in when the button is pressed", async () => {
    const handleLogin = vi.fn().mockResolvedValue(undefined);
    render(<OktaLogin handleLogin={handleLogin} />);

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /sign in with okta/i }));

    expect(handleLogin).toHaveBeenCalledTimes(1);
  });
});
