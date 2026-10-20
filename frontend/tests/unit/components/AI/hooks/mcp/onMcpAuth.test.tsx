import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { apiClient } from "~/api/api";
import {
  finishMcpSignIn,
  useMcpAuthCallback,
} from "~/components/AI/hooks/mcp/onMcpAuth";

const posted: unknown[] = [];

class FakeBroadcastChannel {
  constructor(readonly name: string) {}
  postMessage(message: unknown) {
    posted.push({ channel: this.name, message });
  }
  close() {}
}

beforeEach(() => {
  vi.clearAllMocks();
  posted.length = 0;
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("finishMcpSignIn", () => {
  it("hands code and state to the API and tells the opener", async () => {
    (apiClient.post as Mock).mockResolvedValue({
      data: { server_url: "https://mcp.example.com/mcp" },
    });

    await finishMcpSignIn(new URLSearchParams({ code: "c", state: "s" }));

    expect(apiClient.post).toHaveBeenCalledWith("/app/mcp-oauth/complete", {
      code: "c",
      state: "s",
    });
    expect(posted).toEqual([
      {
        channel: "mcp-auth",
        message: {
          type: "mcp_auth_callback",
          success: true,
          serverUrl: "https://mcp.example.com/mcp",
        },
      },
    ]);
  });

  it("reports a refused sign-in without calling the API", async () => {
    await expect(
      finishMcpSignIn(new URLSearchParams({ error: "access_denied" })),
    ).rejects.toThrow("The sign-in was refused: access_denied");

    expect(apiClient.post).not.toHaveBeenCalled();
    expect(posted).toEqual([
      {
        channel: "mcp-auth",
        message: {
          type: "mcp_auth_callback",
          success: false,
          error: "The sign-in was refused: access_denied",
        },
      },
    ]);
  });
});

function Callback() {
  const error = useMcpAuthCallback();
  return <p data-testid="error">{error}</p>;
}

describe("useMcpAuthCallback", () => {
  it("shows an error from the authorization server as text, never as markup", async () => {
    const description = '<img src="x" onerror="alert(1)">';
    render(
      <MemoryRouter
        initialEntries={[
          `/oauth/callback?error=invalid_request&error_description=${encodeURIComponent(description)}`,
        ]}
      >
        <Callback />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("error")).toHaveTextContent(description),
    );
    expect(document.querySelector("img")).toBeNull();
  });

  it("completes the sign-in once and closes the window", async () => {
    (apiClient.post as Mock).mockResolvedValue({ data: {} });
    const close = vi.spyOn(window, "close").mockImplementation(() => {});

    const { rerender } = render(
      <MemoryRouter initialEntries={["/oauth/callback?code=c&state=s"]}>
        <Callback />
      </MemoryRouter>,
    );
    rerender(
      <MemoryRouter initialEntries={["/oauth/callback?code=c&state=s"]}>
        <Callback />
      </MemoryRouter>,
    );

    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(apiClient.post).toHaveBeenCalledTimes(1);
  });
});
