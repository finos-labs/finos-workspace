import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyWhiteLabelMeta,
  getContrastTextColor,
  getRelativeLuminance,
  hexToRgb,
} from "~/utils/colorUtils";

describe("hexToRgb", () => {
  describe("valid 6-digit hex colors", () => {
    it("should convert hex with # prefix", () => {
      expect(hexToRgb("#000000")).toEqual({ r: 0, g: 0, b: 0 });
      expect(hexToRgb("#ffffff")).toEqual({ r: 255, g: 255, b: 255 });
      expect(hexToRgb("#ff0000")).toEqual({ r: 255, g: 0, b: 0 });
      expect(hexToRgb("#00ff00")).toEqual({ r: 0, g: 255, b: 0 });
      expect(hexToRgb("#0000ff")).toEqual({ r: 0, g: 0, b: 255 });
    });

    it("should convert hex without # prefix", () => {
      expect(hexToRgb("000000")).toEqual({ r: 0, g: 0, b: 0 });
      expect(hexToRgb("ffffff")).toEqual({ r: 255, g: 255, b: 255 });
      expect(hexToRgb("ff0000")).toEqual({ r: 255, g: 0, b: 0 });
    });

    it("should handle uppercase hex values", () => {
      expect(hexToRgb("#FFFFFF")).toEqual({ r: 255, g: 255, b: 255 });
      expect(hexToRgb("#FF0000")).toEqual({ r: 255, g: 0, b: 0 });
      expect(hexToRgb("ABCDEF")).toEqual({ r: 171, g: 205, b: 239 });
    });

    it("should handle mixed case hex values", () => {
      expect(hexToRgb("#FfFfFf")).toEqual({ r: 255, g: 255, b: 255 });
      expect(hexToRgb("aAbBcC")).toEqual({ r: 170, g: 187, b: 204 });
    });

    it("should convert common brand colors correctly", () => {
      expect(hexToRgb("#1a73e8")).toEqual({ r: 26, g: 115, b: 232 });
      expect(hexToRgb("#34a853")).toEqual({ r: 52, g: 168, b: 83 });
      expect(hexToRgb("#fbbc05")).toEqual({ r: 251, g: 188, b: 5 });
    });
  });

  describe("3-digit hex colors (shorthand)", () => {
    it("should return null for 3-digit hex (not supported by current implementation)", () => {
      expect(hexToRgb("#fff")).toBe(null);
      expect(hexToRgb("#f00")).toBe(null);
      expect(hexToRgb("abc")).toBe(null);
    });
  });

  describe("invalid inputs", () => {
    it("should return null for invalid hex strings", () => {
      expect(hexToRgb("")).toBe(null);
      expect(hexToRgb("#")).toBe(null);
      expect(hexToRgb("##ffffff")).toBe(null);
      expect(hexToRgb("#gggggg")).toBe(null);
      expect(hexToRgb("#12345")).toBe(null);
      expect(hexToRgb("#1234567")).toBe(null);
    });

    it("should return null for non-hex characters", () => {
      expect(hexToRgb("#ghijkl")).toBe(null);
      expect(hexToRgb("zzzzzz")).toBe(null);
      expect(hexToRgb("#12345g")).toBe(null);
    });

    it("should return null for rgb/rgba format strings", () => {
      expect(hexToRgb("rgb(255, 0, 0)")).toBe(null);
      expect(hexToRgb("rgba(255, 0, 0, 1)")).toBe(null);
    });

    it("should return null for color names", () => {
      expect(hexToRgb("red")).toBe(null);
      expect(hexToRgb("blue")).toBe(null);
      expect(hexToRgb("transparent")).toBe(null);
    });

    it("should return null for special values", () => {
      expect(hexToRgb("inherit")).toBe(null);
      expect(hexToRgb("initial")).toBe(null);
      expect(hexToRgb("currentColor")).toBe(null);
    });
  });

  describe("edge cases", () => {
    it("should handle boundary RGB values", () => {
      expect(hexToRgb("#000000")).toEqual({ r: 0, g: 0, b: 0 });
      expect(hexToRgb("#ffffff")).toEqual({ r: 255, g: 255, b: 255 });
    });

    it("should correctly parse mid-range values", () => {
      expect(hexToRgb("#808080")).toEqual({ r: 128, g: 128, b: 128 });
      expect(hexToRgb("#7f7f7f")).toEqual({ r: 127, g: 127, b: 127 });
    });
  });
});

describe("getRelativeLuminance", () => {
  it("should calculate luminance correctly for various colors", () => {
    expect(getRelativeLuminance("#000000")).toBeCloseTo(0, 4);
    expect(getRelativeLuminance("#ffffff")).toBeCloseTo(1, 4);
    expect(getRelativeLuminance("#ff0000")).toBeCloseTo(0.2126, 4);
    expect(getRelativeLuminance("#00ff00")).toBeCloseTo(0.7152, 4);
    expect(getRelativeLuminance("#0000ff")).toBeCloseTo(0.0722, 4);
  });

  it("should handle invalid hex by returning 0", () => {
    expect(getRelativeLuminance("invalid")).toBe(0);
  });
});

describe("getContrastTextColor", () => {
  it("should return var(--color-light-700) for light backgrounds", () => {
    expect(getContrastTextColor("#ffffff")).toBe("var(--color-light-700)");
    expect(getContrastTextColor("#ffeb3b")).toBe("var(--color-light-700)");
    expect(getContrastTextColor("#f5f5f5")).toBe("var(--color-light-700)");
  });

  it("should return var(--color-light-100) for dark backgrounds", () => {
    expect(getContrastTextColor("#000000")).toBe("var(--color-light-100)");
    expect(getContrastTextColor("#1a73e8")).toBe("var(--color-light-100)");
    expect(getContrastTextColor("#333333")).toBe("var(--color-light-100)");
  });
});

describe("applyWhiteLabelMeta", () => {
  let ogTitle: HTMLMetaElement;
  let twitterTitle: HTMLMetaElement;
  let descriptionMeta: HTMLMetaElement;
  let ogDescription: HTMLMetaElement;
  let twitterDescription: HTMLMetaElement;
  let keywordsMeta: HTMLMetaElement;
  let iconLink: HTMLLinkElement;
  let appleTouchLink: HTMLLinkElement;

  beforeEach(() => {
    ogTitle = document.createElement("meta");
    ogTitle.setAttribute("property", "og:title");
    ogTitle.setAttribute("content", "");
    document.head.appendChild(ogTitle);

    twitterTitle = document.createElement("meta");
    twitterTitle.setAttribute("property", "twitter:title");
    twitterTitle.setAttribute("content", "");
    document.head.appendChild(twitterTitle);

    descriptionMeta = document.createElement("meta");
    descriptionMeta.setAttribute("name", "description");
    descriptionMeta.setAttribute("content", "");
    document.head.appendChild(descriptionMeta);

    ogDescription = document.createElement("meta");
    ogDescription.setAttribute("property", "og:description");
    ogDescription.setAttribute("content", "");
    document.head.appendChild(ogDescription);

    twitterDescription = document.createElement("meta");
    twitterDescription.setAttribute("property", "twitter:description");
    twitterDescription.setAttribute("content", "");
    document.head.appendChild(twitterDescription);

    keywordsMeta = document.createElement("meta");
    keywordsMeta.setAttribute("name", "keywords");
    keywordsMeta.setAttribute("content", "");
    document.head.appendChild(keywordsMeta);

    iconLink = document.createElement("link");
    iconLink.setAttribute("rel", "icon");
    iconLink.setAttribute("href", "/default-favicon.ico");
    document.head.appendChild(iconLink);

    appleTouchLink = document.createElement("link");
    appleTouchLink.setAttribute("rel", "apple-touch-icon");
    appleTouchLink.setAttribute("href", "/default-apple.png");
    document.head.appendChild(appleTouchLink);
  });

  afterEach(() => {
    ogTitle.remove();
    twitterTitle.remove();
    descriptionMeta.remove();
    ogDescription.remove();
    twitterDescription.remove();
    keywordsMeta.remove();
    iconLink.remove();
    appleTouchLink.remove();
    document.title = "";
  });

  it("should set document title and og/twitter title when name is provided", () => {
    applyWhiteLabelMeta({ name: "Acme Corp" });

    expect(document.title).toBe("Acme Corp");
    expect(ogTitle.getAttribute("content")).toBe("Acme Corp");
    expect(twitterTitle.getAttribute("content")).toBe("Acme Corp");
  });

  it("should set the description tag search engines read, plus og and twitter", () => {
    applyWhiteLabelMeta({ description: "Best platform ever" });

    expect(descriptionMeta.getAttribute("content")).toBe("Best platform ever");
    expect(ogDescription.getAttribute("content")).toBe("Best platform ever");
    expect(twitterDescription.getAttribute("content")).toBe("Best platform ever");
  });

  it("should set keywords meta when keywords is provided", () => {
    applyWhiteLabelMeta({ keywords: "finance, data, analytics" });

    expect(keywordsMeta.getAttribute("content")).toBe("finance, data, analytics");
  });

  it("should set favicon and apple-touch-icon when favicon is provided", () => {
    applyWhiteLabelMeta({ favicon: "/custom-favicon.png" });

    expect(iconLink.getAttribute("href")).toBe("/custom-favicon.png");
    expect(appleTouchLink.getAttribute("href")).toBe("/custom-favicon.png");
  });

  it("should apply all fields when all are provided", () => {
    applyWhiteLabelMeta({
      name: "Acme Corp",
      description: "Financial analytics",
      keywords: "finance, data",
      favicon: "/acme.ico",
    });

    expect(document.title).toBe("Acme Corp");
    expect(ogTitle.getAttribute("content")).toBe("Acme Corp");
    expect(descriptionMeta.getAttribute("content")).toBe("Financial analytics");
    expect(ogDescription.getAttribute("content")).toBe("Financial analytics");
    expect(keywordsMeta.getAttribute("content")).toBe("finance, data");
    expect(iconLink.getAttribute("href")).toBe("/acme.ico");
  });

  it("should not modify anything when all fields are empty", () => {
    document.title = "Original";

    applyWhiteLabelMeta({});

    expect(document.title).toBe("Original");
    expect(ogTitle.getAttribute("content")).toBe("");
    expect(iconLink.getAttribute("href")).toBe("/default-favicon.ico");
  });

  it("should not modify title when name is an empty string", () => {
    document.title = "Original";

    applyWhiteLabelMeta({ name: "" });

    expect(document.title).toBe("Original");
  });
});
