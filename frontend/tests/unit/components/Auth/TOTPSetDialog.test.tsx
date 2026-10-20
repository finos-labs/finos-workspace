import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "~/api/api";
import TOTPSetDialog from "~/components/Auth/TOTPSetDialog";

// The code entry (input-otp) needs layout APIs jsdom lacks; this one submits a code
vi.mock("~/components/Auth/TOTPEnterForm", () => ({
  default: ({ handleSubmit }: { handleSubmit: (code: number) => Promise<number> }) => (
    <button type="button" onClick={() => handleSubmit(123456)}>
      Submit code
    </button>
  ),
}));

describe("TOTPSetDialog", () => {
  beforeEach(() => {
    vi.mocked(apiClient.post).mockResolvedValue({
      data: { uri: "otpauth://totp/Workspace:a@b.test?secret=ABC", secret: "ABC" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("stays closed until asked to open", () => {
    render(<TOTPSetDialog open={false} setOpen={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.queryByText("Enter 2FA Code")).not.toBeInTheDocument();
  });

  it("sets up the authenticator with cookies only", async () => {
    const setOpen = vi.fn();
    const user = userEvent.setup();
    render(<TOTPSetDialog open={true} setOpen={setOpen} onCancel={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Generate Token" }));
    expect(apiClient.post).toHaveBeenCalledWith("/totp");
    expect(await screen.findByText("ABC")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Submit code" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/totp/activate");
    expect(init.credentials).toBe("include");
    expect(new Headers(init.headers).get("Authorization")).toBeNull();
    expect(JSON.parse(init.body as string)).toEqual({ totp_token: 123456 });
  });

  it("hands the code to the activation the login page passes, and only to it", async () => {
    const activate = vi.fn(async () => 200);
    const user = userEvent.setup();
    render(
      <TOTPSetDialog
        open={true}
        setOpen={vi.fn()}
        onCancel={vi.fn()}
        activate={activate}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Generate Token" }));
    await user.click(await screen.findByRole("button", { name: "Submit code" }));

    await waitFor(() => expect(activate).toHaveBeenCalledWith(123456));
    expect(activate).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });
});
