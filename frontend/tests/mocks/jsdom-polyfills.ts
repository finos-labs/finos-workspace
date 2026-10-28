import { vi } from "vitest";

class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = ResizeObserver;

global.URL.createObjectURL = vi.fn();

if (!("withResolvers" in Promise)) {
  Object.defineProperty(Promise, "withResolvers", {
    configurable: true,
    writable: true,
    value: <T>() => {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason?: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });

      return { promise, resolve, reject };
    },
  });
}

if (typeof Element.prototype.hasPointerCapture !== "function") {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
}
if (typeof Element.prototype.setPointerCapture !== "function") {
  Element.prototype.setPointerCapture = vi.fn();
}
if (typeof Element.prototype.releasePointerCapture !== "function") {
  Element.prototype.releasePointerCapture = vi.fn();
}

if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = vi.fn();
}

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

const originalGetComputedStyle = window.getComputedStyle;
window.getComputedStyle = (element: Element, pseudoElt?: string | null) => {
  const style = originalGetComputedStyle(element, pseudoElt);
  return new Proxy(style, {
    get(target, prop) {
      const value = target[prop as keyof CSSStyleDeclaration];
      if (
        (prop === "transform" ||
          prop === "webkitTransform" ||
          prop === "mozTransform") &&
        !value
      ) {
        return "none";
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as CSSStyleDeclaration;
};
