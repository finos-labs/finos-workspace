import { describe, expect, it } from "vitest";
import { provideWidgetRows, widgetRows } from "~/lib/widgetRowsRegistry";

describe("the widget rows registry", () => {
  it("asks the card's newest view, and the earlier one again once that view closes", async () => {
    expect(widgetRows("card")).toBeUndefined();
    const card = provideWidgetRows("card", async () => ["card"]);
    const fullscreen = provideWidgetRows("card", async () => ["fullscreen"]);
    await expect(widgetRows("card")).resolves.toEqual(["fullscreen"]);
    fullscreen();
    await expect(widgetRows("card")).resolves.toEqual(["card"]);
    card();
    expect(widgetRows("card")).toBeUndefined();
  });
});
