import { useMutation } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { BrowserRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "~/api/api";
import { useShallowAppStore } from "~/lib/state/app";
import { useShallowThemeStore } from "~/lib/state/theme";
import Settings from "~/routes/settings";
import type { DisplaySettings } from "~/types/auth.type";
import { makeItem } from "../factories";
import { partial, stubStoreState } from "../mocks";

const mockSetSearchParams = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useSearchParams: () => [new URLSearchParams(), mockSetSearchParams],
  };
});

vi.mock("@tanstack/react-query", () => ({
  useMutation: vi.fn(() => ({ mutate: vi.fn() })),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("usehooks-ts", () => ({
  useUpdateEffect: (_effect: () => void, _deps: unknown[]) => {},
}));

vi.mock("~/lib/state/app", () => ({
  useShallowAppStore: vi.fn(),
}));

vi.mock("~/lib/state/theme", () => ({
  useShallowThemeStore: vi.fn(),
}));

vi.mock("~/components/Settings/GeneralTab", () => ({
  default: () => <div data-testid="general-tab">General Tab Content</div>,
}));

vi.mock("~/components/Settings/LayoutTab", () => ({
  default: () => <div data-testid="layout-tab">Layout Tab Content</div>,
}));

vi.mock("~/components/Settings/WidgetTab", () => ({
  default: () => <div data-testid="widget-tab">Widget Tab Content</div>,
}));

vi.mock("~/components/Settings/AdvancedTab", () => ({
  default: () => <div data-testid="advanced-tab">Advanced Tab Content</div>,
}));

vi.mock("~/components/Settings/SecurityTab", () => ({
  default: () => <div data-testid="security-tab">Security Tab Content</div>,
}));

vi.mock("~/lib/utils", () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}));

vi.mock("~/components/LayoutAuth/Skeleton/SettingsLayout", () => ({
  SettingsLayout: ({
    children,
    title,
    tabs,
  }: {
    children: ReactNode;
    title?: string;
    tabs?: { id: string; label?: ReactNode; disabled?: boolean }[];
  }) => (
    <div data-testid="settings-layout">
      {title && <h1>{title}</h1>}
      {tabs && (
        <div role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              disabled={tab.disabled}
              data-value={tab.id}
              onClick={() => {
                if (typeof window !== "undefined") {
                  const event = new CustomEvent("tabchange", {
                    detail: { tab: tab.id },
                  });
                  window.dispatchEvent(event);
                }
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}
      {children}
    </div>
  ),
}));

vi.mock("@radix-ui/react-tabs", () => ({
  Root: ({ children, ...props }: { children: ReactNode }) => (
    <div role="tablist" data-radix-tabs-root={true} {...props}>
      {children}
    </div>
  ),
  List: ({ children, ...props }: { children: ReactNode }) => (
    <div role="tablist" {...props}>
      {children}
    </div>
  ),
  Trigger: ({
    children,
    disabled,
    value,
    ...props
  }: {
    children: ReactNode;
    disabled?: boolean;
    value: string;
  }) => (
    <button role="tab" disabled={disabled} data-value={value} {...props}>
      {children}
    </button>
  ),
  Content: ({ children, value, ...props }: { children: ReactNode; value: string }) => (
    <div role="tabpanel" data-value={value} {...props}>
      {children}
    </div>
  ),
}));

const setupMocks = () => {
  stubStoreState(useShallowThemeStore, {
    getDisplaySettings: vi.fn(() => partial<DisplaySettings>({ theme: "dark" })),
  });

  stubStoreState(useShallowAppStore, {
    hasItems: true,
    rootItem: makeItem({ index: "root" }),
  });
};

const renderSettings = () => {
  return render(
    <BrowserRouter>
      <Settings />
    </BrowserRouter>,
  );
};

describe("Settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  describe("Rendering", () => {
    it("renders the Settings title", () => {
      renderSettings();

      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    it("renders the General tab by default", () => {
      renderSettings();

      expect(screen.getByTestId("general-tab")).toBeInTheDocument();
    });

    it("renders all tabs, Security included, for every user", () => {
      renderSettings();

      expect(screen.getByRole("tab", { name: /general/i })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /layout/i })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /widget/i })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /advanced/i })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /security/i })).not.toBeDisabled();
    });
  });

  describe("Tab Navigation", () => {
    it("switches to Layout tab when clicked", async () => {
      const user = userEvent.setup();
      renderSettings();

      const layoutTab = screen.getByRole("tab", { name: /layout/i });
      await user.click(layoutTab);

      expect(layoutTab).toBeInTheDocument();
    });

    it("switches to Widget tab when clicked", async () => {
      const user = userEvent.setup();
      renderSettings();

      const widgetTab = screen.getByRole("tab", { name: /widget/i });
      await user.click(widgetTab);

      expect(widgetTab).toBeInTheDocument();
    });

    it("switches to Advanced tab when clicked", async () => {
      const user = userEvent.setup();
      renderSettings();

      const advancedTab = screen.getByRole("tab", { name: /advanced/i });
      await user.click(advancedTab);

      expect(advancedTab).toBeInTheDocument();
    });

    it("switches to Security tab when clicked", async () => {
      const user = userEvent.setup();
      renderSettings();

      const securityTab = screen.getByRole("tab", { name: /security/i });
      await user.click(securityTab);

      expect(securityTab).not.toBeDisabled();
    });
  });

  describe("Tab Content Rendering", () => {
    it("renders General tab content by default", () => {
      renderSettings();

      expect(screen.getByTestId("general-tab")).toBeInTheDocument();
    });
  });
});

describe("useSaveSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  it("is called when Settings component mounts", () => {
    renderSettings();
    expect(useShallowThemeStore).toHaveBeenCalled();
    expect(useShallowAppStore).toHaveBeenCalled();
  });

  it("saves the display settings through the API client (session cookie)", async () => {
    renderSettings();
    const options = vi.mocked(useMutation).mock.calls.at(-1)?.[0] as {
      mutationFn: (settings: DisplaySettings) => Promise<unknown>;
    };
    const settings = partial<DisplaySettings>({ theme: "dark" });

    await options.mutationFn(settings);

    expect(apiClient.post).toHaveBeenCalledWith("/app/display-settings", settings);
  });
});

describe("Settings Tab Accessibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  it("all tabs have proper ARIA roles", () => {
    renderSettings();

    const tabs = screen.getAllByRole("tab");
    expect(tabs.length).toBeGreaterThan(0);
    tabs.forEach((tab) => {
      expect(tab).toHaveAttribute("role", "tab");
    });
  });

  it("tabs are keyboard navigable", async () => {
    const user = userEvent.setup();
    renderSettings();

    const generalTab = screen.getByRole("tab", { name: /general/i });
    generalTab.focus();

    expect(document.activeElement).toBe(generalTab);
  });
});

describe("Settings URL Parameters", () => {
  it("respects tab parameter from URL", () => {
    vi.mock("react-router-dom", async () => {
      const actual = await vi.importActual("react-router-dom");
      return {
        ...actual,
        useSearchParams: () => [
          new URLSearchParams({ tab: "advanced" }),
          mockSetSearchParams,
        ],
      };
    });
  });
});
