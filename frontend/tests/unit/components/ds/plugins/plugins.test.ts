import { describe, expect, it, vi } from "vitest";
import {
  typographyClassGroup,
  typographyPlugin,
} from "~/components/ds/plugins/typography";
import { partial } from "../../../mocks";

type PluginApi = Parameters<typeof typographyPlugin.handler>[0];

describe("DS Plugins", () => {
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
