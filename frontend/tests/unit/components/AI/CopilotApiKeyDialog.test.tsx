import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "~/api/api";
import { AgentConfigDialog } from "~/components/AI/AgentConfigDialog";
import { useAuthStore } from "~/lib/state/auth";
import { useThemeStore } from "~/lib/state/theme";
import { makeAuthUser } from "../../factories";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function renderDialog(hasOpenaiKey: boolean) {
  vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
    if (url === "/app/copilot-keys") {
      return { data: { has_openai_key: hasOpenaiKey, has_perplexity_key: false } };
    }
    return { data: [] };
  });
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <AgentConfigDialog />
    </QueryClientProvider>,
  );
}

describe("the user's own OpenAI key", () => {
  beforeEach(() => {
    useAuthStore.setState({ user: makeAuthUser() });
    useThemeStore.setState({ apiKeyDialogOpen: true, agentConfigDialogOpen: false });
    vi.mocked(apiClient.put).mockImplementation(async (_url, body) => ({
      data: {
        has_openai_key:
          (body as { openai_api_key: string | null }).openai_api_key !== null,
        has_perplexity_key: false,
      },
    }));
  });

  afterEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: null });
    useThemeStore.setState({ apiKeyDialogOpen: false });
  });

  it("never shows a saved key, only that one is saved", async () => {
    renderDialog(true);

    expect(await screen.findByText(/A key is saved/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("sk-1234567890abcdefg")).toHaveValue("");
  });

  it("sends a typed key to the API, not to browser storage", async () => {
    localStorage.clear();
    const user = userEvent.setup();
    renderDialog(false);

    await user.type(screen.getByPlaceholderText("sk-1234567890abcdefg"), "sk-new-key");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(apiClient.put).toHaveBeenCalledWith("/app/copilot-keys", {
        openai_api_key: "sk-new-key",
      }),
    );
    expect(JSON.stringify({ ...localStorage })).not.toContain("sk-new-key");
    await waitFor(() => expect(useThemeStore.getState().apiKeyDialogOpen).toBe(false));
  });

  it("removes the saved key with null", async () => {
    const user = userEvent.setup();
    renderDialog(true);

    await user.click(await screen.findByRole("button", { name: "Remove key" }));

    await waitFor(() =>
      expect(apiClient.put).toHaveBeenCalledWith("/app/copilot-keys", {
        openai_api_key: null,
      }),
    );
  });

  it("offers no removal when no key is saved, and no empty save", async () => {
    renderDialog(false);

    await waitFor(() =>
      expect(apiClient.get).toHaveBeenCalledWith("/app/copilot-keys"),
    );
    expect(
      screen.queryByRole("button", { name: "Remove key" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});
