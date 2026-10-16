import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { fetchDefaultAgent } from "~/api/auth.api";
import { getRoleCopilotAccess, putRoleCopilotAccess } from "~/api/entity_roles.api";
import RoleCopilotAccessDialog from "~/components/AdminRoles/RoleCopilotAccessDialog";
import type { RoleT } from "~/components/AdminRoles/types";
import { useCopilotStore } from "~/lib/state/copilot";
import { useMcpToolsStore } from "~/lib/state/mcpTools";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("~/api/auth.api", () => ({ fetchDefaultAgent: vi.fn() }));

vi.mock("~/api/entity_roles.api", () => ({
  getRoleCopilotAccess: vi.fn(),
  putRoleCopilotAccess: vi.fn(),
}));

vi.mock("~/components/ds/dialogs/BaseDialog", () => ({
  BaseDialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
}));

vi.mock("~/components/ds/dialogs/Dialog", () => ({
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const role: RoleT = {
  uuid: "role-1",
  name: "Analysts",
  description: "",
  users: [],
  createdAt: 0,
  sharing: "none",
  copilot_calls_day: 0,
  copilot_tokens_day: 0,
  upload_size_gb: 0,
  excel_add_in: false,
};

function renderDialog() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <RoleCopilotAccessDialog open onClose={onClose} role={role} />
    </QueryClientProvider>,
  );
  return { onClose };
}

describe("RoleCopilotAccessDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (putRoleCopilotAccess as Mock).mockResolvedValue({ success: true });
    (fetchDefaultAgent as Mock).mockResolvedValue(undefined);
    useCopilotStore.setState({
      selectedCopilot: {
        id: "default-copilot",
        name: "Copilot",
        models: [
          { id: "fast", name: "Fast" },
          { id: "smart", name: "Smart" },
        ],
      } as never,
      externalCopilotHolders: [],
    });
    useMcpToolsStore.setState({
      servers: [
        {
          id: "docs",
          name: "Docs",
          url: "https://Docs.example.com/mcp/",
          enabled: true,
          tools: [
            { id: "search", name: "search", enabled: true },
            { id: "delete", name: "delete", enabled: true },
          ],
        },
      ],
    });
  });

  it("shows what the role grants and the choices the admin has", async () => {
    (getRoleCopilotAccess as Mock).mockResolvedValue({
      models: [{ agent_id: "default_agent", model_id: "fast" }],
      mcp: [{ server_url: "https://docs.example.com/mcp", tool_name: "search" }],
    });
    renderDialog();

    const fast = await screen.findByLabelText("Fast");
    await waitFor(() => expect(fast).toBeChecked());
    expect(screen.getByLabelText("Smart")).not.toBeChecked();
    expect(screen.getByLabelText("search")).toBeChecked();
    expect(screen.getByLabelText("delete")).not.toBeChecked();
    expect(screen.getByLabelText("All tools")).not.toBeChecked();
  });

  it("saves the chosen models and tools", async () => {
    (getRoleCopilotAccess as Mock).mockResolvedValue({ models: [], mcp: [] });
    const { onClose } = renderDialog();

    fireEvent.click(await screen.findByLabelText("Smart"));
    fireEvent.click(screen.getByLabelText("search"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(putRoleCopilotAccess).toHaveBeenCalledWith("role-1", {
        models: [{ agent_id: "default_agent", model_id: "smart" }],
        mcp: [{ server_url: "https://docs.example.com/mcp", tool_name: "search" }],
      }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("grants every tool of a server with one box", async () => {
    (getRoleCopilotAccess as Mock).mockResolvedValue({ models: [], mcp: [] });
    renderDialog();

    fireEvent.click(await screen.findByLabelText("All tools"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(putRoleCopilotAccess).toHaveBeenCalledWith("role-1", {
        models: [],
        mcp: [{ server_url: "https://docs.example.com/mcp", tool_name: "*" }],
      }),
    );
  });

  it("offers the models the default agent lists in its model setting", async () => {
    // The admin page has the default agent as the store keeps it, without its descriptor
    useCopilotStore.setState({
      selectedCopilot: {
        id: "default-copilot",
        name: "Copilot",
        features: {},
      } as never,
    });
    (fetchDefaultAgent as Mock).mockResolvedValue({
      id: "default_agent",
      name: "Ines",
      features: {
        model: {
          label: "Model",
          type: "select",
          default: "large",
          options: [
            { label: "Large", value: "large" },
            { label: "Small", value: "small" },
          ],
        },
      },
    });
    (getRoleCopilotAccess as Mock).mockResolvedValue({ models: [], mcp: [] });
    renderDialog();

    fireEvent.click(await screen.findByLabelText("Small"));
    expect(screen.getByLabelText("Large")).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(putRoleCopilotAccess).toHaveBeenCalledWith("role-1", {
        models: [{ agent_id: "default_agent", model_id: "small" }],
        mcp: [],
      }),
    );
  });

  it("keeps grants for models and servers the admin cannot see", async () => {
    (getRoleCopilotAccess as Mock).mockResolvedValue({
      models: [{ agent_id: "custom", model_id: "hidden" }],
      mcp: [{ server_url: "https://gone.example.com/mcp", tool_name: "*" }],
    });
    renderDialog();

    expect(await screen.findByLabelText("hidden")).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(putRoleCopilotAccess).toHaveBeenCalledWith("role-1", {
        models: [{ agent_id: "custom", model_id: "hidden" }],
        mcp: [{ server_url: "https://gone.example.com/mcp", tool_name: "*" }],
      }),
    );
  });
});
