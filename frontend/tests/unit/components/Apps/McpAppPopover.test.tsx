import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { McpAppPopover } from "~/components/Apps/McpAppPopover";
import type { McpConnection, McpServer } from "~/lib/state/mcpTools";
import { setAccess } from "../../factories";

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("~/components/ds/atoms/Button", () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock("~/components/Apps/McpTokenModal", () => ({
  McpTokenModal: ({
    isOpen,
    hasSavedToken,
    onSave,
    onRemove,
  }: {
    isOpen: boolean;
    hasSavedToken?: boolean;
    onSave: (token: string) => void;
    onRemove?: () => void;
  }) =>
    isOpen ? (
      <div data-testid="mcp-token-modal" data-saved={String(!!hasSavedToken)}>
        <button type="button" onClick={() => onSave("tok-123")}>
          save-token
        </button>
        {onRemove && (
          <button type="button" onClick={onRemove}>
            remove-token
          </button>
        )}
      </div>
    ) : null,
}));

const mockAddServer = vi.fn();
const mockUpdateServer = vi.fn();
const mockGetMCPConnection = vi.fn();

type MockMcpState = {
  servers: McpServer[];
  getMCPConnection: (id: string) => McpConnection | undefined;
  addServer: typeof mockAddServer;
  updateServer: typeof mockUpdateServer;
};

let mockMcpState: MockMcpState;

vi.mock("~/lib/state/mcpTools", () => ({
  useShallowMcpToolsStore: (selector: (state: MockMcpState) => unknown) =>
    selector(mockMcpState),
}));

const server = (overrides: Partial<McpServer> = {}): McpServer => ({
  id: "srv-1",
  name: "Demo Token MCP",
  url: "https://example.com/mcp",
  enabled: true,
  tools: [],
  sourceId: "src-1",
  ...overrides,
});

beforeEach(() => {
  mockAddServer.mockClear();
  mockUpdateServer.mockClear();
  mockGetMCPConnection.mockReset();
  mockMcpState = {
    servers: [],
    getMCPConnection: mockGetMCPConnection,
    addServer: mockAddServer,
    updateServer: mockUpdateServer,
  };
  setAccess({ user_type: "Developer" });
});

describe("McpAppPopover", () => {
  it("does not offer Add MCP Server to a User, who cannot add connections", () => {
    setAccess({ user_type: "User" });
    render(
      <McpAppPopover
        sourceId="src-1"
        mcpServer={{ name: "OAuth MCP", url: "https://oauth.example.com/mcp" }}
        isSubscribed={true}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Add MCP Server" }),
    ).not.toBeInTheDocument();
    expect(mockAddServer).not.toHaveBeenCalled();
  });

  it("adds an OAuth server immediately without opening a modal", () => {
    render(
      <McpAppPopover
        sourceId="src-1"
        mcpServer={{ name: "OAuth MCP", url: "https://oauth.example.com/mcp" }}
        isSubscribed={true}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add MCP Server" }));

    expect(mockAddServer).toHaveBeenCalledTimes(1);
    expect(mockAddServer).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "OAuth MCP",
        url: "https://oauth.example.com/mcp",
        sourceId: "src-1",
      }),
    );
    // OAuth path never carries a token authType nor custom headers.
    const added = mockAddServer.mock.calls[0][0];
    expect(added.authType).toBeUndefined();
    expect(added.customHeaders).toBeUndefined();
    expect(screen.queryByTestId("mcp-token-modal")).not.toBeInTheDocument();
  });

  it("opens the token modal instead of adding immediately for a token server", () => {
    render(
      <McpAppPopover
        sourceId="src-1"
        mcpServer={{
          name: "Demo Token MCP",
          url: "https://example.com/mcp",
          authType: "token",
        }}
        isSubscribed={true}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add MCP Server" }));

    expect(mockAddServer).not.toHaveBeenCalled();
    expect(screen.getByTestId("mcp-token-modal")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "save-token" }));

    expect(mockAddServer).toHaveBeenCalledTimes(1);
    expect(mockAddServer).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Demo Token MCP",
        url: "https://example.com/mcp",
        authType: "token",
        customHeaders: { Authorization: "Bearer tok-123" },
      }),
    );
  });

  it("replaces the saved token of an already-added failed token server", () => {
    // The API says a token is saved; its value never reaches the page
    mockMcpState.servers = [
      server({
        authType: "token",
        customHeaderNames: ["Authorization"],
        hasToken: true,
      }),
    ];
    mockGetMCPConnection.mockReturnValue({
      state: "failed",
      error: "Couldn't authenticate with Demo Token MCP.",
      tools: [],
    } as unknown as McpConnection);

    render(
      <McpAppPopover
        sourceId="src-1"
        mcpServer={{
          name: "Demo Token MCP",
          url: "https://example.com/mcp",
          authType: "token",
        }}
        isSubscribed={true}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Replace token" }));
    expect(screen.getByTestId("mcp-token-modal")).toHaveAttribute("data-saved", "true");
    fireEvent.click(screen.getByRole("button", { name: "save-token" }));

    expect(mockAddServer).not.toHaveBeenCalled();
    // `enabled` is part of the payload because auto-registration leaves
    // token-auth servers disabled until a token exists; the connection
    // reconnects with the new token once it is saved.
    expect(mockUpdateServer).toHaveBeenCalledWith(
      "srv-1",
      {
        customHeaders: { Authorization: "Bearer tok-123" },
        authType: "token",
        enabled: true,
      },
      true,
    );
  });

  it("removes the saved token and turns the server off", () => {
    mockMcpState.servers = [
      server({
        authType: "token",
        customHeaderNames: ["Authorization"],
        hasToken: true,
      }),
    ];
    mockGetMCPConnection.mockReturnValue({
      state: "ready",
      tools: [],
    } as unknown as McpConnection);

    render(
      <McpAppPopover
        sourceId="src-1"
        mcpServer={{
          name: "Demo Token MCP",
          url: "https://example.com/mcp",
          authType: "token",
        }}
        isSubscribed={true}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Replace token" }));
    fireEvent.click(screen.getByRole("button", { name: "remove-token" }));

    expect(mockUpdateServer).toHaveBeenCalledWith("srv-1", {
      customHeaders: { Authorization: null },
      enabled: false,
    });
  });
});
