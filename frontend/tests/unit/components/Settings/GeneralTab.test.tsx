import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { Tabs } from "~/components/ds/molecules/Tabs";
import GeneralTab from "~/components/Settings/GeneralTab";

import { useShallowThemeStore } from "~/lib/state/theme";
import { mockConfig } from "../../../mocks/runtimeConfig";

vi.mock("~/lib/state/theme", () => ({
  useShallowThemeStore: vi.fn(),
}));

const mockUpdateDisplaySettings = vi.fn();

(useShallowThemeStore as Mock).mockReturnValue({
  theme: "light",
  aiEnhancements: false,
  fontSize: "medium",
  updateDisplaySettings: mockUpdateDisplaySettings,
});

describe("GeneralTab Component", () => {
  const queryClient = new QueryClient();

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.copilot.enabled = true;
    mockConfig.copilot.aiEnhancements = true;
  });

  const renderWithQueryClient = (ui: React.ReactElement) =>
    render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);

  it("renders all sections correctly", () => {
    renderWithQueryClient(
      <Tabs value="general">
        <GeneralTab />
      </Tabs>,
    );
    expect(screen.getByText("Theme")).toBeInTheDocument();
    expect(screen.getByText("Font size")).toBeInTheDocument();
    expect(screen.getByText("AI enhancements (recommended)")).toBeInTheDocument();
  });

  it("renders theme selection and updates settings on change", () => {
    renderWithQueryClient(
      <Tabs value="general">
        <GeneralTab />
      </Tabs>,
    );

    const darkModeRadio = screen.getByTestId("theme-dark");
    const lightModeRadio = screen.getByTestId("theme-light");

    expect(darkModeRadio).toBeInTheDocument();
    expect(lightModeRadio).toBeInTheDocument();

    fireEvent.click(darkModeRadio);
    expect(mockUpdateDisplaySettings).toHaveBeenCalledWith({ theme: "dark" });
  });

  it("renders font size selection and updates settings on change", () => {
    renderWithQueryClient(
      <Tabs value="general">
        <GeneralTab />
      </Tabs>,
    );

    const mediumFontRadio = screen.getByTestId("font-medium");
    const largeFontRadio = screen.getByTestId("font-large");

    expect(mediumFontRadio).toBeInTheDocument();
    expect(largeFontRadio).toBeInTheDocument();

    fireEvent.click(largeFontRadio);
    expect(mockUpdateDisplaySettings).toHaveBeenCalledWith({ fontSize: "large" });
  });

  it("renders AI enhancements checkbox and updates settings on change", () => {
    renderWithQueryClient(
      <Tabs value="general">
        <GeneralTab />
      </Tabs>,
    );

    const aiEnhancementsCheckbox = screen.queryByRole("checkbox", {
      name: /Enable AI-powered features/i,
    });

    expect(aiEnhancementsCheckbox).toBeInTheDocument();

    if (aiEnhancementsCheckbox) {
      fireEvent.click(aiEnhancementsCheckbox);
      expect(mockUpdateDisplaySettings).toHaveBeenCalledWith({ aiEnhancements: true });
    }
  });
});
