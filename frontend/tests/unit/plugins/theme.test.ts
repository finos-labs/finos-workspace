import { afterEach, describe, expect, it, vi } from "vitest";
import { readThemeTrait } from "~/plugins/theme";

function fakeCanvas(pixel: number[], accepted: (value: string) => boolean) {
  let fill = "#000000";
  const context = {
    get fillStyle() {
      return fill;
    },
    set fillStyle(value: string) {
      if (accepted(value)) fill = value;
    },
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    getImageData: () => ({ data: pixel }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
}

describe("readThemeTrait", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.removeAttribute("style");
  });

  it("reads the tokens that the app defines and leaves out the others", () => {
    document.body.style.setProperty("--background", "#0b2432");
    document.body.style.setProperty("--foreground", "#e7f2f8");

    const trait = readThemeTrait("light");

    expect(trait.mode).toBe("light");
    expect(trait.tokens.background).toBe("#0b2432");
    expect(trait.tokens.foreground).toBe("#e7f2f8");
    expect(trait.tokens.card).toBeUndefined();
  });

  it("gives a colour that is not a hex value as a hex value", () => {
    document.body.style.setProperty(
      "--brand-lighter",
      "color-mix(in srgb, #0086bf 70%, white)",
    );
    fakeCanvas([77, 170, 210, 255], () => true);

    expect(readThemeTrait("dark").tokens["brand-lighter"]).toBe("#4daad2");
  });

  it("keeps a value that the canvas does not accept as a colour", () => {
    document.body.style.setProperty("--brand-lighter", "not-a-colour");
    fakeCanvas([0, 0, 0, 255], (value) => value === "#010203" || value === "#000000");

    expect(readThemeTrait("dark").tokens["brand-lighter"]).toBe("not-a-colour");
  });

  it("keeps a colour with transparency as it is", () => {
    document.body.style.setProperty("--brand-lighter", "rgb(0 0 0 / 50%)");
    fakeCanvas([0, 0, 0, 128], () => true);

    expect(readThemeTrait("dark").tokens["brand-lighter"]).toBe("rgb(0 0 0 / 50%)");
  });
});
