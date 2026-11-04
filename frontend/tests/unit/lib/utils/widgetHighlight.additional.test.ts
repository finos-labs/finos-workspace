import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scrollToAndHighlightWidget } from "~/lib/utils/widgetHighlight";

describe("widgetHighlight utils - Additional Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    vi.useFakeTimers();

    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((cb) => setTimeout(cb, 16)),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe("scrollToAndHighlightWidget with options", () => {
    it("should wait for layout when waitForLayout is true", async () => {
      const widgetId = "test-widget";
      const element = document.createElement("div");
      element.id = widgetId;
      document.body.appendChild(element);
      element.scrollIntoView = vi.fn();

      const promise = scrollToAndHighlightWidget(widgetId, {
        waitForLayout: true,
        layoutDelay: 100,
      });

      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(1100);
      await vi.advanceTimersByTimeAsync(1500);

      await promise;

      expect(element.scrollIntoView).toHaveBeenCalled();
    });

    it("should use custom layoutDelay", async () => {
      const widgetId = "test-widget";
      const element = document.createElement("div");
      element.id = widgetId;
      document.body.appendChild(element);
      element.scrollIntoView = vi.fn();

      const promise = scrollToAndHighlightWidget(widgetId, {
        waitForLayout: true,
        layoutDelay: 500,
      });

      expect(element.scrollIntoView).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(600);
      await vi.advanceTimersByTimeAsync(1200);
      await vi.advanceTimersByTimeAsync(1500);

      await promise;

      expect(element.scrollIntoView).toHaveBeenCalled();
    });
  });

  describe("highlight behavior", () => {
    it("should add highlight class to element", async () => {
      const widgetId = "test-widget-highlight";
      const element = document.createElement("div");
      element.id = widgetId;
      document.body.appendChild(element);
      element.scrollIntoView = vi.fn();

      const promise = scrollToAndHighlightWidget(widgetId);

      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(1100);

      expect(element.classList.contains("widget-highlight")).toBe(true);

      await vi.advanceTimersByTimeAsync(1500);

      await promise;

      expect(element.classList.contains("widget-highlight")).toBe(false);
    });
  });

  describe("error handling", () => {
    it("should handle errors gracefully", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const widgetId = "error-widget";
      const element = document.createElement("div");
      element.id = widgetId;
      document.body.appendChild(element);
      element.scrollIntoView = vi.fn(() => {
        throw new Error("Scroll error");
      });

      const promise = scrollToAndHighlightWidget(widgetId);

      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(1100);
      await vi.advanceTimersByTimeAsync(1500);

      await promise;

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Error"),
        expect.any(Error),
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe("element not found", () => {
    it("should give up after max attempts", async () => {
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const promise = scrollToAndHighlightWidget("nonexistent-widget");

      for (let i = 0; i < 15; i++) {
        await vi.advanceTimersByTimeAsync(20);
      }

      await vi.advanceTimersByTimeAsync(1100);

      await promise;

      expect(consoleWarnSpy).toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });
  });
});
