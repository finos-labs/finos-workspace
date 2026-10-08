import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import OktaLogin from "~/components/LayoutUnauth/OktaLogin";

const useOktaAuth = vi.hoisted(() => vi.fn());
vi.mock("@okta/okta-react", () => ({ useOktaAuth }));

describe("OktaLogin", () => {
  it("shows the Okta button when there is an Okta context", () => {
    useOktaAuth.mockReturnValue({ oktaAuth: {} });

    render(<OktaLogin handleLogin={vi.fn()} />);

    expect(
      screen.getByRole("button", { name: /sign in with okta/i }),
    ).toBeInTheDocument();
  });

  it("shows nothing, and does not crash, when the Okta issuer was not valid", () => {
    useOktaAuth.mockReturnValue(null);

    const { container } = render(<OktaLogin handleLogin={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });
});
