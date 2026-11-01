import { JSDOM } from "jsdom";

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', { url: "https://localhost/" });

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLDivElement = dom.window.HTMLDivElement;
globalThis.Node = dom.window.Node;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.MouseEvent = dom.window.MouseEvent;
globalThis.Event = dom.window.Event;
dom.window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame;
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

export function makeModel(values) {
  const listeners = {};
  return {
    values: { theme: { mode: "light" }, adminSettings: {}, config: {}, state: null, ...values },
    get(key) { return this.values[key]; },
    set(key, value) { this.values[key] = value; },
    save_changes() {},
    on(name, cb) { (listeners[name] = listeners[name] || []).push(cb); },
    off(name, cb) { listeners[name] = (listeners[name] || []).filter((c) => c !== cb); },
    emit(name, ...args) { (listeners[name] || []).forEach((cb) => cb(...args)); },
    listenerCount(name) { return (listeners[name] || []).length; },
  };
}

export const settle = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));

export function mount() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return { el, abort: new AbortController() };
}
