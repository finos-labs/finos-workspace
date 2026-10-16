import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotContext } from "~/components/AI/CopilotContext";
import { useCopilotStore } from "~/lib/state/copilot";
import { useCopilotAccessStore } from "~/lib/state/copilotAccess";

const {
  mockFetchDefaultAgent,
  mockShowNotification,
  mockUseShallowCopilotStore,
  mockUseShallowCopilotDataStore,
} = vi.hoisted(() => ({
  mockFetchDefaultAgent: vi.fn(),
  mockShowNotification: vi.fn(),
  mockUseShallowCopilotStore: vi.fn(),
  mockUseShallowCopilotDataStore: vi.fn(),
}));

vi.mock("~/api/auth.api", () => ({
  fetchDefaultAgent: (...args: unknown[]) => mockFetchDefaultAgent(...args),
}));

vi.mock("~/components/Tooltip", () => ({
  default: ({ children }: { children: ReactNode; message: ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("~/components/Icon", () => ({
  default: ({ id }: { id: string }) => <span data-testid={`icon-${id}`} />,
}));

vi.mock("~/components/ds/atoms/HintLabel", () => ({
  HintLabel: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("~/components/ds/atoms/Input", () => ({
  Input: () => <input type="text" />,
}));

vi.mock("~/components/ds/atoms/Popover", () => ({
  Popover: ({
    children,
    content,
    open,
  }: {
    children: ReactNode;
    content?: ReactNode;
    open?: boolean;
  }) => (
    <div>
      {children}
      {open ? content : null}
    </div>
  ),
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("~/components/ds/atoms/Select", () => ({
  SelectRoot: ({ children, value }: { children: ReactNode; value?: string }) => (
    <div data-value={value}>{children}</div>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => <button>{children}</button>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("~/components/AI/hooks/useCopilotAddToContext", () => ({
  useCopilotContextSuggestions: () => ({
    searchSuggestions: vi.fn(),
    getRichWidgetTooltip: vi.fn(),
    handleKeyDown: vi.fn(),
    suggestionElements: [],
    handleRemoveMentionFromText: vi.fn(),
  }),
}));

vi.mock("~/components/AI/hooks/useGetCopilotRequestHeaders", () => ({
  useGetCopilotRequestHeaders: () => () => ({}),
}));

vi.mock("~/components/AI/McpToolsButton", () => ({
  McpToolsButton: () => <div data-testid="mcp-tools-button" />,
}));

type CopilotStoreState = {
  selectedCopilot: {
    holderUuid?: string | null;
    features: Record<string, boolean | object | undefined>;
  } | null;
  setSelectedCopilot: ReturnType<typeof vi.fn>;
  initializeCustomFeatures: ReturnType<typeof vi.fn>;
  setHovered: ReturnType<typeof vi.fn>;
  setHoveredTabId: ReturnType<typeof vi.fn>;
  hoveredTabId: null | string;
};

type CopilotDataStoreState = {
  copilotWidgets: {
    selectedWidgets: Array<{
      uuid?: string;
      widget_id?: string;
      metadata?: { innerTabId?: string };
      name?: string;
    }>;
  };
  extraWidgetsEnabled: boolean;
  toggleExtraWidgetsEnabled: ReturnType<typeof vi.fn>;
  generativeUiEnabled: boolean;
  toggleGenerativeUiEnabled: ReturnType<typeof vi.fn>;
  toggleSelectedWidget: ReturnType<typeof vi.fn>;
  isMentionTrackedWidget: ReturnType<typeof vi.fn>;
  getCopilotWidgets: ReturnType<typeof vi.fn>;
  removeMentionTrackedWidget: ReturnType<typeof vi.fn>;
  isWidgetSelected: ReturnType<typeof vi.fn>;
  setCopilotWidgets: ReturnType<typeof vi.fn>;
  removeDataFromDashboardWidget: ReturnType<typeof vi.fn>;
  removePreSelectedWidget: ReturnType<typeof vi.fn>;
};

let copilotStoreState: CopilotStoreState;
let copilotDataStoreState: CopilotDataStoreState;

describe("CopilotContext", () => {
  beforeEach(() => {
    mockFetchDefaultAgent.mockResolvedValue(undefined);
    mockShowNotification.mockReset();

    copilotStoreState = {
      selectedCopilot: {
        holderUuid: null,
        features: {},
      },
      setSelectedCopilot: vi.fn(),
      initializeCustomFeatures: vi.fn(),
      setHovered: vi.fn(),
      setHoveredTabId: vi.fn(),
      hoveredTabId: null,
    };

    copilotDataStoreState = {
      copilotWidgets: {
        selectedWidgets: [],
      },
      extraWidgetsEnabled: false,
      toggleExtraWidgetsEnabled: vi.fn(),
      generativeUiEnabled: false,
      toggleGenerativeUiEnabled: vi.fn(),
      toggleSelectedWidget: vi.fn(),
      isMentionTrackedWidget: vi.fn().mockReturnValue(false),
      getCopilotWidgets: vi.fn().mockReturnValue({ selectedWidgets: [] }),
      removeMentionTrackedWidget: vi.fn(),
      isWidgetSelected: vi.fn().mockReturnValue(false),
      setCopilotWidgets: vi.fn(),
      removeDataFromDashboardWidget: vi.fn(),
      removePreSelectedWidget: vi.fn(),
    };

    mockUseShallowCopilotStore.mockImplementation(
      (selector: (state: object) => unknown) => selector(copilotStoreState),
    );
    mockUseShallowCopilotDataStore.mockImplementation(
      (selector: (state: object) => unknown) => selector(copilotDataStoreState),
    );
  });

  it("renders the copilot settings button", () => {
    render(<CopilotContext />);

    expect(
      screen.getByRole("button", { name: "Agent settings" }),
    ).toBeInTheDocument();
  });

  describe("an agent that offers its models through its model setting", () => {
    const grant = (...modelIds: string[]) =>
      useCopilotAccessStore.setState({
        access: {
          models: modelIds.map((model_id) => ({ agent_id: "default_agent", model_id })),
          mcp: [],
        },
      });

    const openSettings = () => {
      render(<CopilotContext />);
      fireEvent.click(screen.getByRole("button", { name: "Copilot settings" }));
    };

    beforeEach(() => {
      // The web app knows the default agent as default-copilot
      useCopilotStore.setState({
        selectedCopilot: {
          id: "default-copilot",
          name: "Ines",
          description: "",
          endpoints: {},
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
        },
        customFeatureStates: { model: "large" },
      });
    });

    it("offers only the models the user's roles grant", () => {
      grant("small");
      openSettings();

      expect(screen.queryByText("Large")).not.toBeInTheDocument();
      expect(screen.getByText("Small").closest("[data-value]")).toHaveAttribute(
        "data-value",
        "small",
      );
    });

    it("shows no model setting when the user's roles grant no model", () => {
      grant();
      openSettings();

      expect(screen.queryByText("Model")).not.toBeInTheDocument();
      expect(screen.queryByText("Large")).not.toBeInTheDocument();
      expect(screen.queryByText("Small")).not.toBeInTheDocument();
    });
  });
});
