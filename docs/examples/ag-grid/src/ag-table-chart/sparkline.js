/*
 * OpenBB's `sparkline` column option, as AG Grid 32's sparklineOptions.
 *
 * OpenBB          AG Grid 32
 * line, area      line, area: line.stroke/strokeWidth, marker
 * bar             column (vertical, the default) or bar (direction "horizontal")
 * min, max        valueAxisDomain (bars only; AG Grid 32 has no domain for lines)
 * pointsOfInterest and customFormatter
 *                 marker.formatter (line, area) or formatter (bars), which receive the same
 *                 { yValue, first, last, min, max, highlighted } params.
 */
import { compileFormatter } from "./expression.js";
import { withOpacity } from "./colors.js";

const DEFAULT_POINT_SIZE = 5;
const STYLE_KEYS = ["fill", "stroke", "strokeWidth", "size"];

function pick(style) {
  const out = {};
  if (!style || typeof style !== "object") return out;
  for (const key of STYLE_KEYS) if (style[key] !== undefined) out[key] = style[key];
  return out;
}

/** The style the OpenBB points of interest give one point, lowest precedence first. */
export function pointStyle(points, params) {
  if (!points || typeof points !== "object") return null;
  let style = null;
  const add = (s) => { if (s) style = { ...(style ?? {}), ...pick(s) }; };
  const y = params.yValue;
  if (points.positiveNegative && typeof y === "number") add(y >= 0 ? points.positiveNegative.positive : points.positiveNegative.negative);
  if ((params.first || params.last) && points.firstLast) add(points.firstLast);
  if (params.min && points.minimum) add(points.minimum);
  if (params.max && points.maximum) add(points.maximum);
  if (params.highlighted && points.highlighted) add(points.highlighted);
  return style;
}

function compile(source) {
  if (!source) return null;
  try {
    return compileFormatter(source);
  } catch (e) {
    console.warn("ag-grid sparkline customFormatter:", e.message);
    return null;
  }
}

function applyOpacity(style, opacity) {
  const out = { ...style };
  const alpha = typeof out.fillOpacity === "number" ? out.fillOpacity : opacity;
  if (out.fill && typeof alpha === "number") out.fill = withOpacity(out.fill, alpha);
  delete out.fillOpacity;
  return out;
}

export function sparklineOptions(sparkline) {
  const type = sparkline?.type ?? "line";
  const o = sparkline?.options && typeof sparkline.options === "object" ? sparkline.options : {};
  const custom = compile(o.customFormatter);
  const points = o.pointsOfInterest;
  const options = {};
  if (o.padding) options.padding = { ...o.padding };

  if (type === "bar") {
    options.type = o.direction === "horizontal" ? "bar" : "column";
    if (o.fill) options.fill = withOpacity(o.fill, o.fillOpacity);
    if (o.stroke) options.stroke = o.stroke;
    if (typeof o.strokeWidth === "number") options.strokeWidth = o.strokeWidth;
    if (typeof o.min === "number" && typeof o.max === "number") options.valueAxisDomain = [o.min, o.max];
    if (points || custom) {
      options.formatter = (params) => {
        const style = { ...(pointStyle(points, params) ?? {}), ...(custom ? custom(params) : {}) };
        delete style.size;
        return applyOpacity(style, o.fillOpacity);
      };
    }
    return options;
  }

  options.type = type === "area" ? "area" : "line";
  const line = {};
  if (o.stroke) line.stroke = o.stroke;
  if (typeof o.strokeWidth === "number") line.strokeWidth = o.strokeWidth;
  if (Object.keys(line).length) options.line = line;
  if (type === "area" && o.fill) options.fill = withOpacity(o.fill, o.fillOpacity ?? 0.3);

  const markers = o.markers && typeof o.markers === "object" ? o.markers : {};
  const markersOn = markers.enabled === true;
  if (markersOn || points || custom) {
    const base = markersOn ? pick(markers) : { size: 0 };
    options.marker = { enabled: true, ...base };
    options.marker.formatter = (params) => {
      const poi = pointStyle(points, params);
      const style = { ...base, ...(poi ?? {}), ...(custom ? custom(params) : {}) };
      if (!markersOn && poi && style.size === 0) style.size = DEFAULT_POINT_SIZE;
      return applyOpacity(style, undefined);
    };
  }
  if (points?.highlighted) options.highlightStyle = pick(points.highlighted);
  return options;
}

/** The sparkline's numbers, from an array, a {values} object or a JSON string. */
export function sparklineData(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  if (value && typeof value === "object" && Array.isArray(value.values)) return value.values;
  return [];
}
