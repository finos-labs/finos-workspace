const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const SENTINEL = "#010203";

export function toHex(value: string): string {
  if (HEX_COLOR.test(value)) return value;
  const context = document.createElement("canvas").getContext("2d", {
    willReadFrequently: true,
  });
  if (!context) return value;
  context.fillStyle = SENTINEL;
  context.fillStyle = value;
  if (context.fillStyle === SENTINEL) return value;
  context.clearRect(0, 0, 1, 1);
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
  if (alpha !== 255) return value;
  return `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: Number.parseInt(result[1], 16),
        g: Number.parseInt(result[2], 16),
        b: Number.parseInt(result[3], 16),
      }
    : null;
}

export function getRelativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;

  const [rs, gs, bs] = [rgb.r / 255, rgb.g / 255, rgb.b / 255].map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );

  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

export function getContrastTextColor(bgHex: string): string {
  const luminance = getRelativeLuminance(bgHex);
  return luminance > 0.22 ? "var(--color-light-700)" : "var(--color-light-100)";
}

export function applyWhiteLabelMeta(whiteLabel: {
  name?: string;
  description?: string;
  keywords?: string;
  favicon?: string;
}) {
  if (whiteLabel.name) {
    document.title = whiteLabel.name;
    document
      .querySelector('meta[property="og:title"]')
      ?.setAttribute("content", whiteLabel.name);
    document
      .querySelector('meta[property="twitter:title"]')
      ?.setAttribute("content", whiteLabel.name);
  }
  if (whiteLabel.description) {
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute("content", whiteLabel.description);
    document
      .querySelector('meta[property="og:description"]')
      ?.setAttribute("content", whiteLabel.description);
    document
      .querySelector('meta[property="twitter:description"]')
      ?.setAttribute("content", whiteLabel.description);
  }
  if (whiteLabel.keywords) {
    document
      .querySelector('meta[name="keywords"]')
      ?.setAttribute("content", whiteLabel.keywords);
  }
  if (whiteLabel.favicon) {
    document
      .querySelector('link[rel="icon"]')
      ?.setAttribute("href", whiteLabel.favicon);
    if (!whiteLabel.favicon.endsWith(".svg")) {
      document
        .querySelector('link[rel="apple-touch-icon"]')
        ?.setAttribute("href", whiteLabel.favicon);
    }
  }
}
