import { act } from "@testing-library/react";
import { AxiosError } from "axios";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteThemePreset,
  getThemePresets,
  putActiveThemePreset,
  putThemePreset,
} from "~/api/admin.api";
import { isDirty, savedVariants, useThemePresetsStore } from "~/lib/state/themePresets";

const refresh = vi.hoisted(() => vi.fn());

vi.mock("~/api/admin.api", () => ({
  getThemePresets: vi.fn(),
  putThemePreset: vi.fn(),
  deleteThemePreset: vi.fn(),
  putActiveThemePreset: vi.fn(),
}));

vi.mock("~/lib/state/entityTheme", () => ({
  useEntityThemeStore: { getState: () => ({ updateThemeSettings: refresh }) },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

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

const state = () => useThemePresetsStore.getState();

async function load(presets = [violet, teal], active: string | null = violet.uuid) {
  vi.mocked(getThemePresets).mockResolvedValue({ presets, active_preset: active });
  await act(async () => {
    await state().load();
  });
}

describe("useThemePresetsStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useThemePresetsStore.setState({
      presets: [],
      activeId: null,
      selectedId: null,
      draft: { light: {}, dark: {} },
      loaded: false,
    });
  });

  describe("load", () => {
    it("selects the applied preset and starts from its values", async () => {
      await load();

      expect(state().presets).toEqual([violet, teal]);
      expect(state().activeId).toBe(violet.uuid);
      expect(state().selectedId).toBe(violet.uuid);
      expect(state().draft).toEqual({ light: violet.light, dark: violet.dark });
      expect(isDirty(state())).toBe(false);
    });

    it("starts from the FINOS theme when no preset applies", async () => {
      await load([violet], null);

      expect(state().selectedId).toBeNull();
      expect(state().draft).toEqual({ light: {}, dark: {} });
    });

    it("keeps the edits and the selection when it loads again", async () => {
      await load();
      act(() => state().setValue("light", "--link-color", "#ff0000"));
      await load();

      expect(state().draft.light["--link-color"]).toBe("#ff0000");
      expect(state().selectedId).toBe(violet.uuid);
    });

    it("moves to the applied preset when the selected one no longer exists", async () => {
      await load();
      act(() => state().select(teal.uuid));
      await load([violet], violet.uuid);

      expect(state().selectedId).toBe(violet.uuid);
      expect(state().draft.light).toEqual(violet.light);
    });

    it("reports a failure without changing the state", async () => {
      vi.mocked(getThemePresets).mockRejectedValue(new Error("down"));
      await act(async () => {
        await state().load();
      });

      expect(toast.error).toHaveBeenCalledWith("Could not load the theme presets");
      expect(state().loaded).toBe(false);
    });
  });

  describe("editing", () => {
    beforeEach(() => load());

    it("sets and clears a value in one scope", () => {
      act(() => state().setValue("dark", "--link-color", "#00ff00"));
      expect(state().draft.dark["--link-color"]).toBe("#00ff00");
      expect(state().draft.light["--link-color"]).toBeUndefined();
      expect(isDirty(state())).toBe(true);

      act(() => state().clearValue("dark", "--link-color"));
      expect(state().draft.dark["--link-color"]).toBeUndefined();
      expect(isDirty(state())).toBe(false);
    });

    it("does not change the saved preset while editing", () => {
      act(() => state().setValue("light", "--color-main-100", "#000000"));

      expect(savedVariants(state()).light["--color-main-100"]).toBe("#7b2d8e");
      expect(state().presets[0].light["--color-main-100"]).toBe("#7b2d8e");
    });

    it("reverts to the saved values", () => {
      act(() => state().setValue("light", "--color-main-100", "#000000"));
      act(() => state().revert());

      expect(state().draft.light).toEqual(violet.light);
      expect(isDirty(state())).toBe(false);
    });

    it("loads another preset into the draft", () => {
      act(() => state().select(teal.uuid));

      expect(state().selectedId).toBe(teal.uuid);
      expect(state().draft).toEqual({ light: teal.light, dark: teal.dark });
    });

    it("goes back to the FINOS theme", () => {
      act(() => state().select(null));

      expect(state().draft).toEqual({ light: {}, dark: {} });
    });
  });

  describe("save", () => {
    beforeEach(() => load());

    it("stores the draft in the selected preset", async () => {
      act(() => state().setValue("light", "--color-main-100", "#000000"));
      vi.mocked(putThemePreset).mockImplementation(async (preset) => preset);

      let ok = false;
      await act(async () => {
        ok = await state().save();
      });

      expect(ok).toBe(true);
      expect(putThemePreset).toHaveBeenCalledWith({
        uuid: violet.uuid,
        name: "Violet",
        light: { "--color-main-100": "#000000" },
        dark: violet.dark,
      });
      expect(state().presets[0].light["--color-main-100"]).toBe("#000000");
      expect(isDirty(state())).toBe(false);
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("leaves the applied theme alone when the saved preset is not applied", async () => {
      act(() => state().select(teal.uuid));
      act(() => state().setValue("light", "--link-color", "#123456"));
      vi.mocked(putThemePreset).mockImplementation(async (preset) => preset);
      await act(async () => {
        await state().save();
      });

      expect(refresh).not.toHaveBeenCalled();
    });

    it("keeps the draft and says why when the server refuses", async () => {
      act(() => state().setValue("light", "--link-color", "#123456"));
      vi.mocked(putThemePreset).mockRejectedValue(
        new AxiosError("conflict", "ERR_BAD_REQUEST", undefined, undefined, {
          status: 409,
          data: { detail: "A theme preset with this name already exists" },
        } as never),
      );

      let ok = true;
      await act(async () => {
        ok = await state().save();
      });

      expect(ok).toBe(false);
      expect(toast.error).toHaveBeenCalledWith(
        "A theme preset with this name already exists",
      );
      expect(state().draft.light["--link-color"]).toBe("#123456");
    });

    it("cannot save the FINOS theme", async () => {
      act(() => state().select(null));
      await act(async () => {
        expect(await state().save()).toBe(false);
      });

      expect(putThemePreset).not.toHaveBeenCalled();
    });
  });

  describe("saveAs", () => {
    it("creates a preset from the draft and selects it", async () => {
      await load([violet], null);
      act(() => state().setValue("light", "--color-main-100", "#112233"));
      vi.mocked(putThemePreset).mockImplementation(async (preset) => preset);

      let ok = false;
      await act(async () => {
        ok = await state().saveAs("Navy");
      });

      const created = state().presets[1];
      expect(ok).toBe(true);
      expect(created).toMatchObject({
        name: "Navy",
        light: { "--color-main-100": "#112233" },
        dark: {},
      });
      expect(created.uuid).toMatch(/^[0-9a-f-]{36}$/);
      expect(state().selectedId).toBe(created.uuid);
      expect(isDirty(state())).toBe(false);
      expect(state().activeId).toBeNull();
    });
  });

  describe("rename", () => {
    it("changes the name and keeps the unsaved edits", async () => {
      await load();
      act(() => state().setValue("light", "--link-color", "#123456"));
      vi.mocked(putThemePreset).mockImplementation(async (preset) => preset);
      await act(async () => {
        await state().rename("Purple");
      });

      expect(putThemePreset).toHaveBeenCalledWith({ ...violet, name: "Purple" });
      expect(state().presets[0].name).toBe("Purple");
      expect(state().draft.light["--link-color"]).toBe("#123456");
    });
  });

  describe("remove", () => {
    it("deletes the preset, returns to the FINOS theme and refreshes when it was applied", async () => {
      await load();
      vi.mocked(deleteThemePreset).mockResolvedValue({
        presets: [teal],
        active_preset: null,
      });
      await act(async () => {
        await state().remove();
      });

      expect(deleteThemePreset).toHaveBeenCalledWith(violet.uuid);
      expect(state().presets).toEqual([teal]);
      expect(state().activeId).toBeNull();
      expect(state().selectedId).toBeNull();
      expect(state().draft).toEqual({ light: {}, dark: {} });
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("does not refresh when the preset was not applied", async () => {
      await load();
      act(() => state().select(teal.uuid));
      vi.mocked(deleteThemePreset).mockResolvedValue({
        presets: [violet],
        active_preset: violet.uuid,
      });
      await act(async () => {
        await state().remove();
      });

      expect(refresh).not.toHaveBeenCalled();
    });
  });

  describe("activate", () => {
    it("applies a preset to everyone and reloads the applied theme", async () => {
      await load();
      vi.mocked(putActiveThemePreset).mockResolvedValue({
        presets: [violet, teal],
        active_preset: teal.uuid,
      });
      await act(async () => {
        await state().activate(teal.uuid);
      });

      expect(putActiveThemePreset).toHaveBeenCalledWith(teal.uuid);
      expect(state().activeId).toBe(teal.uuid);
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("returns everyone to the FINOS theme", async () => {
      await load();
      vi.mocked(putActiveThemePreset).mockResolvedValue({
        presets: [violet, teal],
        active_preset: null,
      });
      await act(async () => {
        await state().activate(null);
      });

      expect(putActiveThemePreset).toHaveBeenCalledWith(null);
      expect(state().activeId).toBeNull();
    });
  });
});
