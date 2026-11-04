import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteThemePreset,
  getThemePresets,
  putActiveThemePreset,
  putThemePreset,
} from "~/api/admin.api";
import { PresetsSettings } from "~/components/ThemeSettings/PresetsSettings";
import { useThemeStore } from "~/lib/state/theme";
import { useThemePresetsStore } from "~/lib/state/themePresets";
import { applyPreviewTheme } from "~/lib/theme/sheet";

vi.mock("~/api/admin.api", () => ({
  getThemePresets: vi.fn(),
  putThemePreset: vi.fn(),
  deleteThemePreset: vi.fn(),
  putActiveThemePreset: vi.fn(),
}));

vi.mock("~/lib/state/entityTheme", () => ({
  useEntityThemeStore: { getState: () => ({ updateThemeSettings: vi.fn() }) },
}));

vi.mock("~/lib/theme/sheet", () => ({ applyPreviewTheme: vi.fn() }));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("~/components/ds/atoms/Select", () => ({
  Select: ({
    options,
    value,
    onChange,
    disabled,
    ...rest
  }: {
    options: { label: string; value: string }[];
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
    "aria-label"?: string;
  }) => (
    <select
      aria-label={rest["aria-label"]}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

const violet = {
  uuid: "11111111-1111-4111-8111-111111111111",
  name: "Violet",
  light: { "--color-main-100": "#7b2d8e" },
  dark: { "--color-main-100": "#a64bbd" },
};
const teal = {
  uuid: "22222222-2222-4222-8222-222222222222",
  name: "Teal",
  light: { "--color-main-100": "#008080" },
  dark: {},
};

async function renderLoaded(active: string | null = violet.uuid) {
  vi.mocked(getThemePresets).mockResolvedValue({
    presets: [violet, teal],
    active_preset: active,
  });
  render(<PresetsSettings />);
  await waitFor(() => expect(screen.getByLabelText("Preset")).toBeEnabled());
}

const edit = () =>
  fireEvent.change(screen.getByLabelText("--color-main-100"), {
    target: { value: "#112233" },
  });

describe("PresetsSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (!document.querySelector('meta[name="color-scheme"]')) {
      const meta = document.createElement("meta");
      meta.name = "color-scheme";
      document.head.appendChild(meta);
    }
    act(() => {
      useThemeStore.getState().setTheme("light");
      useThemePresetsStore.setState({
        presets: [],
        activeId: null,
        selectedId: null,
        draft: { light: {}, dark: {} },
        loaded: false,
      });
    });
  });

  it("opens on the applied preset", async () => {
    await renderLoaded();

    expect(screen.getByLabelText("Preset")).toHaveValue(violet.uuid);
    expect(screen.getByText("Applied to everyone")).toBeInTheDocument();
    expect(screen.getByLabelText("--color-main-100")).toHaveValue("#7b2d8e");
  });

  it("lists the FINOS theme and the presets, and marks the applied one", async () => {
    await renderLoaded();

    const labels = Array.from(
      screen.getByLabelText("Preset").querySelectorAll("option"),
    ).map((option) => option.textContent);
    expect(labels).toEqual(["FINOS (default)", "Violet (applied)", "Teal"]);
  });

  it("previews the draft in the app and removes the preview when it closes", async () => {
    vi.mocked(getThemePresets).mockResolvedValue({
      presets: [violet],
      active_preset: violet.uuid,
    });
    const { unmount } = render(<PresetsSettings />);
    await waitFor(() =>
      expect(applyPreviewTheme).toHaveBeenLastCalledWith({
        light: violet.light,
        dark: violet.dark,
      }),
    );

    edit();
    await waitFor(() =>
      expect(applyPreviewTheme).toHaveBeenLastCalledWith({
        light: { "--color-main-100": "#112233" },
        dark: violet.dark,
      }),
    );

    unmount();
    expect(applyPreviewTheme).toHaveBeenLastCalledWith(null);
  });

  it("switches the app between the light and dark theme with the mode tabs", async () => {
    await renderLoaded();

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Dark Mode" }));
    fireEvent.click(screen.getByRole("tab", { name: "Dark Mode" }));

    await waitFor(() => expect(useThemeStore.getState().theme).toBe("dark"));
    expect(screen.getByLabelText("--color-main-100")).toHaveValue("#a64bbd");
  });

  it("enables Save and Revert only after a change, and Revert restores the saved values", async () => {
    await renderLoaded();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Revert" })).toBeDisabled();

    edit();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Revert" }));
    expect(screen.getByLabelText("--color-main-100")).toHaveValue("#7b2d8e");
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  });

  it("saves the changes into the selected preset", async () => {
    await renderLoaded();
    vi.mocked(putThemePreset).mockImplementation(async (preset) => preset);

    edit();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(putThemePreset).toHaveBeenCalledWith({
        uuid: violet.uuid,
        name: "Violet",
        light: { "--color-main-100": "#112233" },
        dark: violet.dark,
      }),
    );
    await waitFor(() => expect(screen.queryByText("Unsaved changes")).toBeNull());
  });

  it("saves the changes as a new preset with a name", async () => {
    await renderLoaded();
    vi.mocked(putThemePreset).mockImplementation(async (preset) => preset);

    edit();
    fireEvent.click(screen.getByRole("button", { name: "Save as…" }));
    fireEvent.change(await screen.findByLabelText("Preset name"), {
      target: { value: "Navy" },
    });
    const buttons = screen.getAllByRole("button", { name: "Save" });
    fireEvent.click(buttons[buttons.length - 1]);

    await waitFor(() =>
      expect(putThemePreset).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Navy",
          light: { "--color-main-100": "#112233" },
        }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Preset").querySelectorAll("option")).toHaveLength(
        4,
      ),
    );
  });

  it("asks before it drops unsaved changes for another preset", async () => {
    await renderLoaded();
    edit();

    fireEvent.change(screen.getByLabelText("Preset"), { target: { value: teal.uuid } });
    expect(await screen.findByText("Discard unsaved changes")).toBeInTheDocument();
    expect(screen.getByLabelText("Preset")).toHaveValue(violet.uuid);

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(screen.getByLabelText("Preset")).toHaveValue(teal.uuid));
    expect(screen.getByLabelText("--color-main-100")).toHaveValue("#008080");
  });

  it("goes to another preset without asking when nothing changed", async () => {
    await renderLoaded();

    fireEvent.change(screen.getByLabelText("Preset"), { target: { value: teal.uuid } });

    expect(screen.queryByText("Discard unsaved changes")).toBeNull();
    expect(screen.getByLabelText("--color-main-100")).toHaveValue("#008080");
  });

  it("applies the selected preset to everyone", async () => {
    await renderLoaded();
    vi.mocked(putActiveThemePreset).mockResolvedValue({
      presets: [violet, teal],
      active_preset: teal.uuid,
    });
    fireEvent.change(screen.getByLabelText("Preset"), { target: { value: teal.uuid } });

    fireEvent.click(screen.getByRole("button", { name: "Apply to everyone" }));

    await waitFor(() => expect(putActiveThemePreset).toHaveBeenCalledWith(teal.uuid));
    await waitFor(() =>
      expect(screen.getByText("Applied to everyone")).toBeInTheDocument(),
    );
  });

  it("applies the FINOS theme to everyone", async () => {
    await renderLoaded();
    vi.mocked(putActiveThemePreset).mockResolvedValue({
      presets: [violet, teal],
      active_preset: null,
    });
    fireEvent.change(screen.getByLabelText("Preset"), { target: { value: "default" } });

    fireEvent.click(screen.getByRole("button", { name: "Apply to everyone" }));

    await waitFor(() => expect(putActiveThemePreset).toHaveBeenCalledWith(null));
  });

  it("cannot apply a preset with unsaved changes", async () => {
    await renderLoaded(null);
    fireEvent.change(screen.getByLabelText("Preset"), { target: { value: teal.uuid } });
    edit();

    expect(screen.getByRole("button", { name: "Apply to everyone" })).toBeDisabled();
  });

  it("deletes the selected preset after a confirmation", async () => {
    await renderLoaded();
    vi.mocked(deleteThemePreset).mockResolvedValue({
      presets: [teal],
      active_preset: null,
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Delete preset")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Yes, Delete" }));

    await waitFor(() => expect(deleteThemePreset).toHaveBeenCalledWith(violet.uuid));
    await waitFor(() => expect(screen.getByLabelText("Preset")).toHaveValue("default"));
  });

  it("cannot rename or delete the FINOS theme", async () => {
    await renderLoaded(null);

    expect(screen.getByRole("button", { name: "Rename" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("shows the stylesheet for what was changed", async () => {
    await renderLoaded(null);
    edit();

    fireEvent.click(screen.getByText("Stylesheet"));

    expect(await screen.findByText(/--color-main-100: #112233;/)).toBeInTheDocument();
  });
});
