import { afterEach, describe, expect, it, vi } from "vitest";
import { loadStylesheet } from "~/utils/stylesheet";

function appended() {
  return document.head.querySelector('link[rel="stylesheet"][href="/theme.css"]');
}

describe("loadStylesheet", () => {
  afterEach(() => {
    appended()?.remove();
    vi.restoreAllMocks();
  });

  it("adds the stylesheet after the existing ones and resolves when it loads", async () => {
    const first = document.createElement("link");
    first.rel = "stylesheet";
    first.href = "/base.css";
    document.head.appendChild(first);

    const loaded = loadStylesheet("/theme.css");
    const link = appended() as HTMLLinkElement;

    expect(link).toBeTruthy();
    expect(document.head.lastElementChild).toBe(link);
    link.dispatchEvent(new Event("load"));
    await expect(loaded).resolves.toBeUndefined();
    first.remove();
  });

  it("resolves when it does not load, so the app still starts", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const loaded = loadStylesheet("/theme.css");
    (appended() as HTMLLinkElement).dispatchEvent(new Event("error"));

    await expect(loaded).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith("The stylesheet /theme.css did not load");
  });
});
