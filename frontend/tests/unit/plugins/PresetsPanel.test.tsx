import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import {
  createPluginPreset,
  deleteOrgPreset,
  deletePluginPreset,
  listPluginPresets,
  type PluginPreset,
  publishOrgPreset,
  updateOrgPreset,
  updatePluginPreset,
} from "~/api/plugins.api";
import { useAuthStore } from "~/lib/state/auth";
import { PresetsPanel } from "~/plugins/PresetsPanel";
import { makeAuthUser } from "../factories";

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));

vi.mock("sonner", () => ({ toast: { error: toastError } }));

vi.mock("~/api/plugins.api", () => ({
  listPluginPresets: vi.fn(),
  createPluginPreset: vi.fn(),
  updatePluginPreset: vi.fn(),
  deletePluginPreset: vi.fn(),
  publishOrgPreset: vi.fn(),
  updateOrgPreset: vi.fn(),
  deleteOrgPreset: vi.fn(),
}));

const preset = (overrides: Partial<PluginPreset>): PluginPreset => ({
  id: "p1",
  name: "Mine",
  scope: "user",
  is_default: false,
  config: { color: "red" },
  state: { zoom: 2 },
  updated_at: "2026-11-01T10:00:00Z",
  ...overrides,
});

const MINE = preset({});
const ORG = preset({
  id: "o1",
  name: "House style",
  scope: "org",
  is_default: true,
  config: { color: "blue" },
  state: null,
});

function renderPanel(
  props: { disabled?: boolean; onApply?: Mock; open?: boolean } = {},
) {
  const onApply = props.onApply ?? vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PresetsPanel
        pluginId="chart"
        widgetId="candles"
        config={{ color: "green" }}
        state={{ zoom: 5 }}
        onApply={onApply}
        disabled={props.disabled}
      />
    </QueryClientProvider>,
  );
  if (props.open !== false)
    fireEvent.click(screen.getByRole("combobox", { name: "Preset" }));
  return { onApply };
}

const SEARCH = "Search presets or name a new one";

const row = async (name: string) =>
  (await screen.findByText(name)).closest("li") as HTMLElement;

describe("the presets of a plugin card", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: null });
    (listPluginPresets as Mock).mockResolvedValue({ presets: [MINE, ORG], limit: 100 });
    (createPluginPreset as Mock).mockResolvedValue(preset({ id: "p2" }));
    (updatePluginPreset as Mock).mockResolvedValue(preset({ is_default: true }));
    (deletePluginPreset as Mock).mockResolvedValue(undefined);
  });

  it("lists the user's presets and the organization's", async () => {
    renderPanel();
    const mine = await row("Mine");
    const org = await row("House style");
    expect(listPluginPresets).toHaveBeenCalledWith("chart", "candles");
    expect(within(org).getByText("Organization")).toBeInTheDocument();
    expect(within(org).getByText("Default")).toBeInTheDocument();
    expect(within(org).queryByRole("button", { name: "Delete" })).toBeNull();
    expect(within(org).queryByRole("button", { name: "Set as default" })).toBeNull();
    expect(within(mine).queryByText("Organization")).toBeNull();
    expect(within(mine).getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("applies a preset with its config and its state", async () => {
    const { onApply } = renderPanel();
    fireEvent.click(within(await row("Mine")).getByRole("button", { name: /^Apply / }));
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ config: { color: "red" }, state: { zoom: 2 } }),
    );
    expect(screen.queryByText("Mine")).toBeNull();
    fireEvent.click(screen.getByRole("combobox", { name: "Preset" }));
    fireEvent.click(
      within(await row("House style")).getByRole("button", { name: /^Apply / }),
    );
    expect(onApply).toHaveBeenLastCalledWith(
      expect.objectContaining({ config: { color: "blue" }, state: null }),
    );
  });

  it("saves the current settings and state under a name", async () => {
    renderPanel();
    await row("Mine");
    expect(
      screen.queryByRole("button", { name: /^Save current settings as/ }),
    ).toBeNull();
    fireEvent.change(screen.getByLabelText(SEARCH), {
      target: { value: "  Weekly  " },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save current settings as “Weekly”" }),
    );
    await waitFor(() =>
      expect(createPluginPreset).toHaveBeenCalledWith("chart", "candles", {
        name: "Weekly",
        config: { color: "green" },
        state: { zoom: 5 },
      }),
    );
    await waitFor(() => expect(listPluginPresets).toHaveBeenCalledTimes(2));
  });

  it("sets a default and deletes the user's own presets", async () => {
    renderPanel();
    fireEvent.click(
      within(await row("Mine")).getByRole("button", { name: "Set as default" }),
    );
    await waitFor(() =>
      expect(updatePluginPreset).toHaveBeenCalledWith("chart", "candles", "p1", {
        is_default: true,
      }),
    );
    await waitFor(() =>
      expect(
        within(screen.getByText("Mine").closest("li") as HTMLElement).getByRole(
          "button",
          { name: "Delete" },
        ),
      ).toBeEnabled(),
    );
    fireEvent.click(within(await row("Mine")).getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(deletePluginPreset).toHaveBeenCalledWith("chart", "candles", "p1"),
    );
  });

  it("leaves the organization's presets to admins", async () => {
    renderPanel();
    const house = await row("House style");
    expect(within(house).queryByRole("button", { name: "Delete" })).toBeNull();
    expect(
      within(await row("Mine")).queryByRole("button", {
        name: "Publish to organization",
      }),
    ).toBeNull();
  });

  it("lets an admin publish, default and delete the organization's presets", async () => {
    useAuthStore.setState({ user: makeAuthUser({ role: "Admin" }) });
    (listPluginPresets as Mock).mockResolvedValue({
      presets: [MINE, { ...ORG, is_default: false }],
      limit: 100,
    });
    renderPanel();
    fireEvent.click(
      within(await row("Mine")).getByRole("button", {
        name: "Publish to organization",
      }),
    );
    await waitFor(() =>
      expect(publishOrgPreset).toHaveBeenCalledWith("chart", "candles", {
        name: "Mine",
        config: { color: "red" },
        state: { zoom: 2 },
      }),
    );
    await waitFor(() =>
      expect(
        within(screen.getByText("House style").closest("li") as HTMLElement).getByRole(
          "button",
          { name: "Set as default" },
        ),
      ).toBeEnabled(),
    );
    fireEvent.click(
      within(await row("House style")).getByRole("button", { name: "Set as default" }),
    );
    await waitFor(() =>
      expect(updateOrgPreset).toHaveBeenCalledWith("chart", "candles", "o1", {
        is_default: true,
      }),
    );
    await waitFor(() =>
      expect(
        within(screen.getByText("House style").closest("li") as HTMLElement).getByRole(
          "button",
          { name: "Delete" },
        ),
      ).toBeEnabled(),
    );
    fireEvent.click(
      within(await row("House style")).getByRole("button", { name: "Delete" }),
    );
    await waitFor(() =>
      expect(deleteOrgPreset).toHaveBeenCalledWith("chart", "candles", "o1"),
    );
    expect(deletePluginPreset).not.toHaveBeenCalled();
  });

  it("shows each problem of a refused request", async () => {
    (createPluginPreset as Mock).mockRejectedValue({
      response: {
        status: 422,
        data: { detail: [{ msg: "name is too long" }, { msg: "bad state" }] },
      },
    });
    renderPanel();
    await row("Mine");
    fireEvent.change(screen.getByLabelText(SEARCH), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save current settings as/ }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Preset: name is too long; bad state"),
    );
  });

  it("shows the server's refusal", async () => {
    (createPluginPreset as Mock).mockRejectedValue({
      response: { status: 409, data: { detail: "You keep 100 presets already" } },
    });
    renderPanel();
    await row("Mine");
    fireEvent.change(screen.getByLabelText(SEARCH), {
      target: { value: "One more" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Save current settings as/ }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        expect.stringContaining("You keep 100 presets already"),
      ),
    );
  });

  it("is read-only on a shared dashboard", async () => {
    renderPanel({ disabled: true });
    const mine = await row("Mine");
    expect(within(mine).getByRole("button", { name: /^Apply / })).toBeDisabled();
    expect(within(mine).getByRole("button", { name: "Set as default" })).toBeDisabled();
    expect(within(mine).getByRole("button", { name: "Delete" })).toBeDisabled();
    expect(
      within(await row("House style")).getByRole("button", { name: /^Apply / }),
    ).toBeDisabled();
    expect(screen.getByLabelText(SEARCH)).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: /^Save current settings as/ }),
    ).toBeNull();
  });

  it("filters the list by what is typed", async () => {
    renderPanel();
    await row("Mine");
    fireEvent.change(screen.getByLabelText(SEARCH), { target: { value: "hous" } });
    expect(screen.queryByText("Mine")).toBeNull();
    expect(screen.getByText("House style")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(SEARCH), { target: { value: "MINE" } });
    expect(screen.getByText("Mine")).toBeInTheDocument();
    expect(screen.queryByText("House style")).toBeNull();
  });

  it("offers to save under the typed name when nothing matches", async () => {
    renderPanel();
    await row("Mine");
    fireEvent.change(screen.getByLabelText(SEARCH), { target: { value: "Quarterly" } });
    expect(screen.queryByText("Mine")).toBeNull();
    expect(screen.queryByText("House style")).toBeNull();
    expect(screen.getByText("No presets match.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save current settings as “Quarterly”" }),
    ).toBeEnabled();
  });

  it("saves the typed name when Enter is pressed", async () => {
    renderPanel();
    await row("Mine");
    const search = screen.getByLabelText(SEARCH);
    fireEvent.change(search, { target: { value: "Daily" } });
    fireEvent.keyDown(search, { key: "Enter" });
    await waitFor(() =>
      expect(createPluginPreset).toHaveBeenCalledWith("chart", "candles", {
        name: "Daily",
        config: { color: "green" },
        state: { zoom: 5 },
      }),
    );
  });

  it("clears the search when the list is closed", async () => {
    renderPanel();
    await row("Mine");
    fireEvent.change(screen.getByLabelText(SEARCH), { target: { value: "hous" } });
    fireEvent.click(screen.getByRole("combobox", { name: "Preset" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Preset" }));
    expect(screen.getByLabelText(SEARCH)).toHaveValue("");
    expect(await row("Mine")).toBeInTheDocument();
  });

  it("is a select field that opens a searchable list", async () => {
    renderPanel({ open: false });
    const field = screen.getByRole("combobox", { name: "Preset" });
    expect(field).toHaveTextContent("Select a preset");
    expect(field).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText(SEARCH)).toBeNull();
    fireEvent.click(field);
    expect(field).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText(SEARCH)).toBeInTheDocument();
    expect(await row("Mine")).toBeInTheDocument();
  });

  it("moves through the list with the arrow keys", async () => {
    renderPanel();
    await row("Mine");
    const search = screen.getByLabelText(SEARCH);
    search.focus();
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(screen.getByRole("button", { name: "Apply Mine" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowDown" });
    expect(screen.getByRole("button", { name: "Apply House style" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowUp" });
    expect(screen.getByRole("button", { name: "Apply Mine" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowUp" });
    expect(search).toHaveFocus();
  });
});
