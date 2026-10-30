/*  `formatterFn`, `decimalPlaces`, `prefix` and `suffix`, as value formatters. */

export const FORMATTERS = ["int", "none", "percent", "normalized", "normalizedPercent", "dateToYear"];

const DEFAULT_DECIMALS = 2;
const formats = new Map();

function numberFormat(locale, minimumFractionDigits, maximumFractionDigits, grouping = true) {
  const key = `${locale}|${minimumFractionDigits}|${maximumFractionDigits}|${grouping}`;
  let format = formats.get(key);
  if (!format) {
    try {
      format = new Intl.NumberFormat(locale || undefined, { minimumFractionDigits, maximumFractionDigits, useGrouping: grouping });
    } catch {
      format = new Intl.NumberFormat(undefined, { minimumFractionDigits, maximumFractionDigits, useGrouping: grouping });
    }
    formats.set(key, format);
  }
  return format;
}

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function yearOf(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : String(value.getUTCFullYear());
  if (typeof value === "number" && Number.isInteger(value) && value > 999 && value < 10000) return String(value);
  if (typeof value === "string") {
    const match = /^(\d{4})/.exec(value.trim());
    if (match) return match[1];
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : String(parsed.getUTCFullYear());
  }
  return null;
}

/**
 * Formats one value the way OpenBB's table does.
 * `options`: { formatterFn, decimalPlaces, prefix, suffix, locale, decimals }.
 */
export function formatValue(value, options = {}) {
  if (value === null || value === undefined || value === "") return "";
  const { formatterFn, decimalPlaces, prefix = "", suffix = "", locale } = options;
  const wrap = (text) => `${prefix}${text}${suffix}`;

  if (formatterFn === "dateToYear") return wrap(yearOf(value) ?? String(value));

  const number = toNumber(value);
  if (number === null) return wrap(String(value));

  const fixed = Number.isInteger(decimalPlaces) ? decimalPlaces : null;
  const decimals = fixed ?? (Number.isInteger(options.decimals) ? options.decimals : DEFAULT_DECIMALS);

  switch (formatterFn) {
    case "none":
      return wrap(fixed === null ? String(number) : number.toFixed(fixed));
    case "int":
      return wrap(numberFormat(locale, 0, fixed ?? 0).format(fixed === null ? Math.round(number) : number));
    case "percent":
      return wrap(`${numberFormat(locale, decimals, decimals).format(number)}%`);
    case "normalized":
      return wrap(numberFormat(locale, decimals, decimals).format(number * 100));
    case "normalizedPercent":
      return wrap(`${numberFormat(locale, decimals, decimals).format(number * 100)}%`);
    default: {
      if (fixed !== null) return wrap(numberFormat(locale, fixed, fixed).format(number));
      return wrap(Number.isInteger(number)
        ? numberFormat(locale, 0, 0).format(number)
        : numberFormat(locale, decimals, decimals).format(number));
    }
  }
}

export function titleCase(text) {
  return String(text)
    .toLowerCase()
    .replace(/(^|[\s_\-/(])(\p{L})/gu, (_, sep, letter) => `${sep}${letter.toUpperCase()}`);
}

/** `revenue_growth` -> `Revenue Growth`, the default header OpenBB shows. */
export function headerFromField(field) {
  return titleCase(String(field).replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2"));
}
