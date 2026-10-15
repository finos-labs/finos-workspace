/* Utility values */

export const current = "currentColor" as const;
export const inherit = "inherit" as const;
export const transparent = "transparent" as const;

/* Primitives */

/* FINOS Brand Visual Guidelines, 5 April 2018 (finos/branding):
   Light Blue #00B5E2, Dark Blue #0086BF.
   Light theme: white plus tints of those blues.
   Dark theme: Dark Blue darkened toward black, with Light Blue and white. */
export const base = {
  0: "#FFFFFF",
  100: "#071820",
} as const;

export const main = {
  50: "#00B5E2",
  100: "#0086BF",
  200: "#005E8A",
} as const;

export const dark = {
  50: "#7699A8",
  100: "#547280",
  200: "#425E6C",
  300: "#375C6C",
  400: "#355867",
  500: "#27556E",
  600: "#1F4A60",
  700: "#1A4154",
  750: "#16394A",
  800: "#123244",
  850: "#0E2B3A",
  900: "#0B2432",
} as const;

export const light = {
  50: "#F4F9FC",
  100: "#E7F2F8",
  200: "#D6E6F0",
  300: "#C5D9E6",
  400: "#B7CDD8",
  500: "#8AA6B8",
  600: "#56748C",
  700: "#3E5C74",
  750: "#345068",
  800: "#2A4460",
  850: "#1A3248",
  900: "#102230",
} as const;

export const error = {
  50: "#FFC5C5",
  100: "#E03C3C",
  200: "#B91C1C",
} as const;

export const success = {
  50: "#CCF7DC",
  100: "#2DAC5C",
  200: "#15803D",
} as const;

export const warning = {
  50: "#FFD4A4",
  100: "#F18A1A",
  200: "#BA6509",
} as const;

export const informative = {
  50: "#C8E7FF",
  100: "#3892D9",
  200: "#065592",
} as const;

export const extra = {
  grey: { 50: "#D9DEE7", 100: "#5C6370", 200: "#4C525D" },
  pink: { 50: "#FFDDF0", 100: "#F467B4", 200: "#612346" },
  turquoise: { 50: "#D5F9FF", 100: "#3C9CAC", 200: "#15373D" },
  burgundy: { 50: "#F1D7E9", 100: "#C965A9", 200: "#5E1146" },
  coral: { 50: "#FFD6C8", 100: "#F26050", 200: "#5E2711" },
  yellow: { 50: "#F5EEA0", 100: "#D2AB21", 200: "#413B1C" },
  orange: { 50: "#FFE2A3", 100: "#D58227", 200: "#52340E" },
  red: { 50: "#FFCACA", 100: "#D53939", 200: "#4E1717" },
  purple: { 50: "#E7DFFF", 100: "#967BED", 200: "#3F285B" },
  green: { 50: "#D2F8D4", 100: "#57BA6F", 200: "#254725" },
  blue: { 50: "#C0EAFF", 100: "#247199", 200: "#126B99" },
} as const;

export const colors = {
  current,
  inherit,
  transparent,

  base,
  main,
  dark,
  light,

  error,
  success,
  warning,
  informative,

  extra,
} as const;
