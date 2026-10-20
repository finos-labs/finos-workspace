import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import McpAuthPopup from "~/components/AI/hooks/mcp/McpAuthPopup";

type McpAuthPopupState = {
  serverName: string;
  url: string;
  authUrl: string;
  popupFeatures: string;
};

const { mockStoreState, mockMcpToolsState } = vi.hoisted(() => ({
  mockStoreState: {
    mcpAuthPopup: null as McpAuthPopupState | null,
    setMcpAuthPopup: vi.fn(),
  },
  mockMcpToolsState: {
    servers: [] as Array<{ id: string; url: string }>,
    disableServerAfterAuthCancel: vi.fn(),
  },
}));

vi.mock("~/lib/state/theme", () => ({
  useShallowThemeStore: (selector: (state: unknown) => unknown) =>
    selector(mockStoreState),
  useThemeStore: { getState: () => mockStoreState },
}));

vi.mock("~/lib/state/mcpTools", () => ({
  useMcpToolsStore: { getState: () => mockMcpToolsState },
}));

vi.mock("~/components/ds/dialogs/BaseDialog", () => ({
  BaseDialog: ({
    open,
    onClose,
    children,
  }: {
    open: boolean;
    onClose?: () => void;
    children: ReactNode;
  }) =>
    open ? (
      <div data-testid="base-dialog">
        <button type="button" data-testid="dialog-close" onClick={onClose} />
        {children}
      </div>
    ) : null,
}));

vi.mock("~/components/ds/dialogs/Dialog", () => ({
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("~/components/ds/atoms/Button", () => ({
  Button: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

const POPUP_VALUE: McpAuthPopupState = {
  serverName: "Test Server",
  url: "https://mcp.example.com",
  authUrl: "https://auth.example.com/authorize",
  popupFeatures: "width=500,height=600",
};

describe("McpAuthPopup", () => {
  beforeEach(() => {
    mockStoreState.mcpAuthPopup = null;
    mockStoreState.setMcpAuthPopup.mockReset();
    mockStoreState.setMcpAuthPopup.mockImplementation(
      (value: McpAuthPopupState | null) => {
        mockStoreState.mcpAuthPopup = value;
      },
    );
    mockMcpToolsState.servers = [];
    mockMcpToolsState.disableServerAfterAuthCancel.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /** A window as window.open returns it, whose opener and location the page sets. */
  function fakeWindow() {
    return {
      closed: false,
      focus: vi.fn(),
      opener: {} as unknown,
      location: { href: "about:blank" },
    };
  }

  it("asks first, showing where the sign-in goes, and opens nothing by itself", () => {
    const openSpy = vi.spyOn(window, "open");
    mockStoreState.mcpAuthPopup = POPUP_VALUE;

    render(<McpAuthPopup />);

    expect(openSpy).not.toHaveBeenCalled();
    expect(screen.getByText("Sign in to Test Server")).toBeInTheDocument();
    expect(screen.getByText("auth.example.com")).toBeInTheDocument();
  });

  it("opens the sign-in from the user's click, cut off from this tab", () => {
    const popup = fakeWindow();
    const openSpy = vi
      .spyOn(window, "open")
      .mockReturnValue(popup as unknown as Window);
    mockStoreState.mcpAuthPopup = POPUP_VALUE;

    render(<McpAuthPopup />);
    fireEvent.click(screen.getByText("Sign in"));

    // The window opens blank, loses its opener, then loads the sign-in page
    expect(openSpy).toHaveBeenCalledWith(
      "about:blank",
      `mcp_auth_${encodeURIComponent(POPUP_VALUE.url)}`,
      POPUP_VALUE.popupFeatures,
    );
    expect(popup.opener).toBeNull();
    expect(popup.location.href).toBe(POPUP_VALUE.authUrl);
    expect(popup.focus).toHaveBeenCalled();
    expect(mockStoreState.setMcpAuthPopup).not.toHaveBeenCalled();
    expect(screen.getByText(/Finish signing in/)).toBeInTheDocument();
  });

  it("disables the server when the user closes the sign-in window", () => {
    vi.useFakeTimers();
    const popup = fakeWindow();
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    mockMcpToolsState.servers = [{ id: "server-1", url: POPUP_VALUE.url }];
    mockStoreState.mcpAuthPopup = POPUP_VALUE;

    render(<McpAuthPopup />);
    fireEvent.click(screen.getByText("Sign in"));

    popup.closed = true;
    vi.advanceTimersByTime(500); // poll detects the close
    vi.advanceTimersByTime(1000); // grace period elapses

    expect(mockMcpToolsState.disableServerAfterAuthCancel).toHaveBeenCalledWith(
      "server-1",
    );
    expect(mockStoreState.setMcpAuthPopup).toHaveBeenCalledWith(null);
  });

  it("does not disable the server if the sign-in succeeded before the grace period", () => {
    vi.useFakeTimers();
    const popup = fakeWindow();
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    mockMcpToolsState.servers = [{ id: "server-1", url: POPUP_VALUE.url }];
    mockStoreState.mcpAuthPopup = POPUP_VALUE;

    render(<McpAuthPopup />);
    fireEvent.click(screen.getByText("Sign in"));

    popup.closed = true;
    vi.advanceTimersByTime(500); // poll detects the close
    // The sign-in's success clears the store slot before the grace period ends
    mockStoreState.mcpAuthPopup = null;
    vi.advanceTimersByTime(1000);

    expect(mockMcpToolsState.disableServerAfterAuthCancel).not.toHaveBeenCalled();
  });

  it("disables the server when the user cancels", () => {
    mockMcpToolsState.servers = [{ id: "server-1", url: POPUP_VALUE.url }];
    mockStoreState.mcpAuthPopup = POPUP_VALUE;

    render(<McpAuthPopup />);
    fireEvent.click(screen.getByText("Cancel"));

    expect(mockMcpToolsState.disableServerAfterAuthCancel).toHaveBeenCalledWith(
      "server-1",
    );
    expect(mockStoreState.setMcpAuthPopup).toHaveBeenCalledWith(null);
  });

  it("offers a link that opens without an opener when the browser blocks the window", () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    mockStoreState.mcpAuthPopup = POPUP_VALUE;

    render(<McpAuthPopup />);
    fireEvent.click(screen.getByText("Sign in"));

    const link = screen.getByRole("link", { name: "auth.example.com" });
    expect(link).toHaveAttribute("href", POPUP_VALUE.authUrl);
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("does nothing when there is no pending sign-in", () => {
    const openSpy = vi.spyOn(window, "open");
    mockStoreState.mcpAuthPopup = null;

    render(<McpAuthPopup />);

    expect(openSpy).not.toHaveBeenCalled();
    expect(mockStoreState.setMcpAuthPopup).not.toHaveBeenCalled();
    expect(screen.queryByTestId("base-dialog")).not.toBeInTheDocument();
  });
});
