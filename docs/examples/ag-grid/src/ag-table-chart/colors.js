/* `columnColor` rules and `greenRed`, as cell styles. */

const NAMED = {
  green: "#16a34a",
  red: "#dc2626",
  blue: "#2563eb",
  yellow: "#ca8a04",
  orange: "#ea580c",
  purple: "#9333ea",
  gray: "#6b7280",
  grey: "#6b7280",
};

export const GREEN = NAMED.green;
export const RED = NAMED.red;

export function resolveColor(color) {
  if (typeof color !== "string") return null;
  return NAMED[color.trim().toLowerCase()] ?? color.trim();
}

function asNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function equal(a, b) {
  const x = asNumber(a);
  const y = asNumber(b);
  return x !== null && y !== null ? x === y : String(a) === String(b);
}

export function ruleMatches(rule, value) {
  if (!rule || value === null || value === undefined) return false;
  const number = asNumber(value);
  const target = asNumber(rule.value);
  switch (rule.condition) {
    case "eq": return equal(value, rule.value);
    case "ne": return !equal(value, rule.value);
    case "gt": return number !== null && target !== null && number > target;
    case "lt": return number !== null && target !== null && number < target;
    case "gte": return number !== null && target !== null && number >= target;
    case "lte": return number !== null && target !== null && number <= target;
    case "between": {
      const min = asNumber(rule.range?.min);
      const max = asNumber(rule.range?.max);
      return number !== null && min !== null && max !== null && number >= min && number <= max;
    }
    case "contains": return String(value).includes(String(rule.value ?? ""));
    case "notContains": return !String(value).includes(String(rule.value ?? ""));
    default: return false;
  }
}

/** The text colour that reads on `background`, a #rgb or #rrggbb colour. */
export function contrastText(background) {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(background ?? "");
  if (!hex) return "#ffffff";
  const digits = hex[1].length === 3 ? hex[1].split("").map((d) => d + d).join("") : hex[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return luminance > 0.4 ? "#111827" : "#ffffff";
}

/** The style of the first rule that matches, or null. */
export function columnColorStyle(rules, value) {
  const rule = (Array.isArray(rules) ? rules : []).find((r) => ruleMatches(r, value));
  if (!rule) return null;
  const color = resolveColor(rule.color);
  if (!color) return null;
  return rule.fill ? { color: contrastText(color), backgroundColor: color } : { color };
}

/** Without rules, `columnColor` colours numbers like `greenRed`. */
export function greenRedStyle(value) {
  const number = asNumber(value);
  if (number === null || number === 0) return null;
  return { color: number > 0 ? GREEN : RED };
}

/** #rrggbb and an opacity as rgba(); any other colour as it is. */
export function withOpacity(color, opacity) {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color ?? "");
  if (!hex || typeof opacity !== "number") return color;
  const digits = hex[1].length === 3 ? hex[1].split("").map((d) => d + d).join("") : hex[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, opacity))})`;
}
