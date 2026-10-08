import { describe, expect, it, vi } from "vitest";
import { strokeWidthPlugin } from "~/components/ds/plugins/stroke";
import {
  typographyClassGroup,
  typographyPlugin,
} from "~/components/ds/plugins/typography";
import { partial } from "../../../mocks";

type PluginApi = Parameters<typeof strokeWidthPlugin.handler>[0];

describe("DS Plugins", () => {
  describe("strokeWidthPlugin", () => {
    it("matches stroke utilities", () => {
      const matchUtilities = vi.fn();
      const theme = vi.fn();
      strokeWidthPlugin.handler(partial<PluginApi>({ matchUtilities, theme }));
      expect(matchUtilities).toHaveBeenCalled();
    });
  });

  describe("typographyPlugin", () => {
    it("adds typography utilities", () => {
      const addUtilities = vi.fn();
      typographyPlugin.handler(partial<PluginApi>({ addUtilities }));
      expect(addUtilities).toHaveBeenCalled();

      const firstClass = `.${typographyClassGroup[0]}`;
      expect(addUtilities).toHaveBeenCalledWith(
        expect.objectContaining({
          [firstClass]: expect.any(Object),
        }),
      );
    });

    it("has expected class groups", () => {
      expect(typographyClassGroup).toContain("title-xs-bold");
      expect(typographyClassGroup).toContain("body-md-regular");
    });
  });
});
