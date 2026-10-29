export * from "./cn";
export * from "./react";

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}



export function clamp(x: number, min: number, max: number) {
  return Math.min(Math.max(x, min), max);
}


export function capitalizeString<T extends string>(string: T) {
  return (string.charAt(0).toUpperCase() + string.slice(1)) as Capitalize<T>;
}


export type CanBeImmutable<T> = T | Readonly<T>;
