import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { PropertyList } from "~/components/ThemeSettings/PropertyList";
import { useThemePresetsStore } from "~/lib/state/themePresets";

const draft = () => useThemePresetsStore.getState().draft;

describe("PropertyList", () => {
  beforeEach(() => {
    act(() => {
      useThemePresetsStore.setState({
        presets: [],
        activeId: null,
        selectedId: null,
        draft: { light: {}, dark: {} },
        loaded: true,
      });
    });
  });

  it("shows the base value of each brand property", () => {
    render(<PropertyList scope="light" />);

    expect(screen.getByLabelText("--color-main-100")).toHaveValue("#0086bf");
    expect(screen.getByLabelText("--color-main-50")).toHaveValue("#00b5e2");
    expect(screen.getByLabelText("--color-main-200")).toHaveValue("#005e8a");
  });

  it("shows the dark declaration in the dark scope", () => {
    render(<PropertyList scope="dark" />);

    fireEvent.change(screen.getByLabelText("Search properties"), {
      target: { value: "--link-color" },
    });

    expect(screen.getByLabelText("--link-color")).toHaveValue("var(--color-main-50)");
  });

  it("shows a light value that the dark scope inherits, and the base value again after a reset", () => {
    act(() => {
      useThemePresetsStore.setState({
        draft: { light: { "--color-main-100": "#7b2d8e" }, dark: {} },
      });
    });
    render(<PropertyList scope="dark" />);

    expect(screen.getByLabelText("--color-main-100")).toHaveValue("#7b2d8e");
    expect(screen.getByLabelText("Reset --color-main-100")).toBeDisabled();

    fireEvent.change(screen.getByLabelText("--color-main-100"), {
      target: { value: "#a64bbd" },
    });
    expect(draft().dark["--color-main-100"]).toBe("#a64bbd");
    expect(draft().light["--color-main-100"]).toBe("#7b2d8e");

    fireEvent.click(screen.getByLabelText("Reset --color-main-100"));
    expect(screen.getByLabelText("--color-main-100")).toHaveValue("#7b2d8e");
  });

  it("puts a typed colour into the draft of the scope", () => {
    render(<PropertyList scope="light" />);

    fireEvent.change(screen.getByLabelText("--color-main-100"), {
      target: { value: "#7b2d8e" },
    });

    expect(draft().light["--color-main-100"]).toBe("#7b2d8e");
    expect(draft().dark).toEqual({});
  });

  it("accepts a reference to another property", () => {
    render(<PropertyList scope="light" />);

    fireEvent.change(screen.getByLabelText("--color-main-contrast"), {
      target: { value: "var(--color-light-700)" },
    });

    expect(draft().light["--color-main-contrast"]).toBe("var(--color-light-700)");
  });

  it("does not take a colour that is not valid", () => {
    render(<PropertyList scope="light" />);

    fireEvent.change(screen.getByLabelText("--color-main-100"), {
      target: { value: "#7b" },
    });

    expect(draft().light).toEqual({});
  });

  it("resets one property to its base value", () => {
    render(<PropertyList scope="light" />);
    fireEvent.change(screen.getByLabelText("--color-main-100"), {
      target: { value: "#7b2d8e" },
    });

    fireEvent.click(screen.getByLabelText("Reset --color-main-100"));

    expect(draft().light).toEqual({});
    expect(screen.getByLabelText("--color-main-100")).toHaveValue("#0086bf");
  });

  it("only enables the reset of a property that was changed", () => {
    render(<PropertyList scope="light" />);

    expect(screen.getByLabelText("Reset --color-main-100")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("--color-main-100"), {
      target: { value: "#7b2d8e" },
    });
    expect(screen.getByLabelText("Reset --color-main-100")).toBeEnabled();
  });

  it("filters the properties by name and opens the groups that match", () => {
    render(<PropertyList scope="light" />);

    fireEvent.change(screen.getByLabelText("Search properties"), {
      target: { value: "btn-primary-bg" },
    });

    expect(screen.getByLabelText("--btn-primary-bg")).toBeInTheDocument();
    expect(screen.getByLabelText("--btn-primary-bg-hover")).toBeInTheDocument();
    expect(screen.queryByLabelText("--color-main-100")).toBeNull();
    expect(screen.queryByLabelText("--link-color")).toBeNull();
  });

  it("says when nothing matches", () => {
    render(<PropertyList scope="light" />);

    fireEvent.change(screen.getByLabelText("Search properties"), {
      target: { value: "no-such-property" },
    });

    expect(screen.getByText("No property matches the search.")).toBeInTheDocument();
  });

  it("derives the shades and the text colour from the brand colour", () => {
    render(<PropertyList scope="light" />);
    const derive = screen.getByRole("button", { name: "Derive from brand color" });
    expect(derive).toBeDisabled();

    fireEvent.change(screen.getByLabelText("--color-main-100"), {
      target: { value: "#ffeb3b" },
    });
    expect(derive).toBeEnabled();
    fireEvent.click(derive);

    expect(draft().light).toEqual({
      "--color-main-100": "#ffeb3b",
      "--color-main-50": "color-mix(in srgb, var(--color-main-100) 70%, white)",
      "--color-main-200": "color-mix(in srgb, var(--color-main-100) 70%, black)",
      "--color-main-contrast": "var(--color-light-700)",
    });
  });

  it("derives a light text colour for a dark brand colour", () => {
    render(<PropertyList scope="light" />);
    fireEvent.change(screen.getByLabelText("--color-main-100"), {
      target: { value: "#10203a" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Derive from brand color" }));

    expect(draft().light["--color-main-contrast"]).toBe("var(--color-light-100)");
  });

  it("lists the font as a menu of the shipped families", () => {
    render(<PropertyList scope="light" />);

    const row = screen.getByTitle("--font-family").parentElement as HTMLElement;
    expect(within(row).getByRole("combobox")).toBeInTheDocument();
  });
});
