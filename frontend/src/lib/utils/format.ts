import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";

dayjs.extend(utc);

const datePattern = /^\d{4}-\d{2}-\d{2}$|^\d{1,2}\/\d{1,2}\/\d{4}$/;

export function isDate(value: dayjs.ConfigType): boolean {
  return datePattern.test(String(value)) && dayjs(value).isValid();
}

export function formatDate(date: dayjs.ConfigType, template = "YYYY-MM-DD"): string {
  // Use UTC mode to avoid timezone shifts when formatting dates
  return dayjs.utc(date).format(template);
}

export function convertToReadableLabel(key: string | undefined): string {
  return (key ?? "")
    .toString()
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
