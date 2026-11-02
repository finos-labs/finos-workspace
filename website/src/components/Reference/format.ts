export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "none";
  if (typeof value === "string") return value === "" ? '""' : value;
  return JSON.stringify(value);
}

export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function shortFile(file: string): string {
  return file.split("/").slice(-2).join("/");
}

const KIBIBYTE = 1024;
const MEBIBYTE = 1024 * 1024;
const NUMBER = new Intl.NumberFormat("en-US");

export type Unit = "bytes" | "ms" | "s" | "min" | "hours" | "days" | "raw";

function bytes(value: number): string {
  if (value % MEBIBYTE === 0) return `${value / MEBIBYTE} MiB`;
  if (value % KIBIBYTE === 0) return `${value / KIBIBYTE} KiB`;
  return `${NUMBER.format(value)} bytes`;
}

function seconds(value: number): string {
  return value === 1 ? "1 second" : `${NUMBER.format(value)} seconds`;
}

function span(value: number, size: number, name: string): string {
  if (value % size !== 0) return seconds(value);
  const count = value / size;
  return count === 1 ? `1 ${name}` : `${NUMBER.format(count)} ${name}s`;
}

export function amount(value: number, unit: Unit | undefined): string {
  if (unit === "raw") return String(value);
  if (unit === "bytes") return bytes(value);
  if (unit === "s") return seconds(value);
  if (unit === "min") return span(value, 60, "minute");
  if (unit === "hours") return span(value, 3600, "hour");
  if (unit === "days") return span(value, 86400, "day");
  if (unit === "ms") return value >= 1000 && value % 1000 === 0 ? seconds(value / 1000) : `${NUMBER.format(value)} ms`;
  return NUMBER.format(value);
}
