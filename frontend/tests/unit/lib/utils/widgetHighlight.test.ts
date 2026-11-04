import { beforeEach, describe, expect, it, vi } from "vitest";
import { scrollToAndHighlightWidget } from "~/lib/utils/widgetHighlight";

describe("widgetHighlight utils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    vi.useFakeTimers();
  });

  it("should scroll to and highlight a widget if it exists", async () => {
    const widgetId = "test-widget";
    const element = document.createElement("div");
    element.id = widgetId;
    document.body.appendChild(element);

    element.scrollIntoView = vi.fn();

    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((cb) => setTimeout(cb, 16)),
    );

    const promise = scrollToAndHighlightWidget(widgetId);

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(1100);
    await vi.advanceTimersByTimeAsync(1500);

    await promise;

    expect(element.scrollIntoView).toHaveBeenCalled();
  });

  it("should warn if element is not found", async () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((cb) => setTimeout(cb, 16)),
    );

    const promise = scrollToAndHighlightWidget("non-existent");

    await vi.advanceTimersByTimeAsync(1000);

    await promise;

    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("not found"));
  });
});
