import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";
import isSameOrAfter from "dayjs/plugin/isSameOrAfter";
import isSameOrBefore from "dayjs/plugin/isSameOrBefore";
import quarterOfYear from "dayjs/plugin/quarterOfYear";
import relativeTime from "dayjs/plugin/relativeTime";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import dayjsBusinessDays from "dayjs-business-days2";
import { toPng } from "html-to-image";
import JSZip from "jszip";
import LinkifyIt from "linkify-it";
import { round } from "lodash";
import { useCallback, useEffect } from "react";
import { v4 as uuidLibv4 } from "uuid";
import type { CreateWidgetParams } from "~/components/AI/hooks/useCreateWidgetFromArtifact";
import type { NewWidgetT, StoredParamValue } from "~/components/types";
import { isDate } from "~/lib/utils/format";
import { areTruthy } from "~/lib/utils/values";
import { butterflyTypes, MAX_SKILL_SLUG_LENGTH } from "../constants";
import type { SaveWidgetsEventT } from "../types";

dayjs.extend(quarterOfYear);
dayjs.extend(relativeTime);
dayjs.extend(isSameOrAfter);
dayjs.extend(isoWeek);
dayjs.extend(isSameOrBefore);
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(dayjsBusinessDays);

export const noop = () => {};

export function isTabPath(pathname: string) {
  return pathname?.includes("/app/") && isUUID(pathname?.split("/app/")?.pop() || "");
}

const linkify = new LinkifyIt();

export function extractUrlsFromText(text: string): string[] {
  try {
    const matches = linkify.match(text);

    if (!matches) {
      return [];
    }

    const urls = matches
      .map((match) => match.url)
      .filter((url) => {
        if (url.endsWith(".name")) return false;
        if (url.startsWith("mailto:")) return false;

        const originalText = matches.find((m) => m.url === url)?.raw || "";
        const urlIndex = text.indexOf(originalText);
        if (urlIndex > 0 && text[urlIndex - 1] === "@") {
          return false;
        }

        return true;
      });

    return urls;
  } catch (e) {
    console.error(e);
    return [];
  }
}

export function toError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error(String(thrown));
}

export function isInputFocused(target: HTMLElement | EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLDivElement && target?.contentEditable === "true")
  );
}

export function isValidUrl(url: string) {
  const urls = extractUrlsFromText(url);
  return urls.length === 1;
}

export function uuidv4() {
  return uuidLibv4();
}

type WidgetUUID = string;

type CustomEvents = {
  saveWidgets: { saveWidgets?: boolean };
  refreshQuery: { refreshQuery?: boolean };
  scrollToTabItem: { tabId: string };
  createWidgetPopup: CreateWidgetParams;
  [key: `runParams-${WidgetUUID}`]: { runParams: boolean };
  [key: `staleParams-${WidgetUUID}`]: { staleParams: boolean };
  [key: `runMetadataUpdate-${WidgetUUID}`]: {
    runMetadataUpdate: boolean;
    metadata?: {
      name?: string;
      description?: string;
      category?: string;
      subCategory?: string;
      source?: string;
    };
  };
  [key: `metadataUpdateComplete-${WidgetUUID}`]: {
    success: boolean;
    metadata?: {
      name?: string;
      description?: string;
      category?: string;
      subCategory?: string;
    };
    error?: string;
  };
  [key: `runComplete-${WidgetUUID}`]: {
    runComplete: boolean;
    requestSucceeded?: boolean;
    hasData?: boolean;
    rowCount?: number;
  };
  [key: `requestStaleState-${WidgetUUID}`]: { requestStaleState: boolean };
  [key: `updateWidget-${WidgetUUID}`]: NewWidgetT;
  [key: `updateQueryParams-${WidgetUUID}`]: Record<string, StoredParamValue>;
  [key: `queryChanged-${WidgetUUID}`]: string;
  [key: `sqlParamHover-${WidgetUUID}`]: { paramName: string | null };
  [key: `sqlParamHoverPill-${WidgetUUID}`]: { paramName: string | null };
  [key: `sqlEditorFocus-${WidgetUUID}`]: { focused: boolean };
};
type EventName = keyof CustomEvents;
// biome-ignore format: off
const booleanEvents = ["saveWidgets", "refreshQuery", "runParams", "staleParams", "runComplete", "requestStaleState"] as EventName[];
// biome-ignore format: off
type EventData<T extends EventName> = T extends { [key: string]: infer U; } ? U : CustomEvents[T];

export function triggerCustomEvent<T extends EventName, DataT = EventData<T>>(
  eventName: T,
  data?: DataT,
) {
  if (
    (typeof data === "boolean" || !data) &&
    booleanEvents.some((e) => eventName.startsWith(e))
  ) {
    const eventKey = eventName.replace(/-(.+)$/, "") as T;
    data = { [eventKey]: data ?? true } as DataT;
  }
  const event = new CustomEvent(eventName, { detail: data });
  return window.dispatchEvent(event);
}

export function useEventListener<T extends EventName>(
  eventName: T,
  handler: (detail: CustomEvents[T]) => void,
) {
  const listener = useCallback(
    (event: Event) => handler((event as CustomEvent).detail),
    [handler],
  );
  useEffect(() => {
    const ctrl = new AbortController();
    window.addEventListener(eventName, listener, { signal: ctrl.signal });
    return () => ctrl.abort();
  }, [eventName, listener]);
}

export async function dispatchSaveState() {
  return window.dispatchEvent(
    new CustomEvent("saveWidgets", {
      detail: { saveWidgets: true },
    } as SaveWidgetsEventT),
  );
}

export async function dispatchRefreshQuery() {
  return window.dispatchEvent(
    new CustomEvent("refreshQuery", {
      detail: { refreshQuery: true },
    }),
  );
}

export async function dispatchUpdateWidget(widgetId: string, newWidget: NewWidgetT) {
  return window.dispatchEvent(
    new CustomEvent(`updateWidget-${widgetId}`, {
      detail: newWidget,
    }),
  );
}

export async function dispatchRunParams(widgetId: string) {
  return queueMicrotask(() =>
    setTimeout(
      () =>
        window.dispatchEvent(
          new CustomEvent(`runParams-${widgetId}`, {
            detail: { runParams: true },
          }),
        ),
      500,
    ),
  );
}

export function capitalize(str: string) {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function shuffle<T>(arr: T[]): T[] {
  let i = arr.length;
  if (i === 0) return arr;
  const copy = [...arr];
  while (--i) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = copy[i] as T;
    const b = copy[j] as T;
    copy[i] = b;
    copy[j] = a;
  }
  return copy;
}

export function saveToLS(localStorageKey: string, key: string, value: unknown) {
  localStorage.setItem(
    localStorageKey,
    JSON.stringify({
      [key]: value,
    }),
  );
}

export const COLORS = [
  "#00B5E2",
  "#EF6689",
  "#16A34A",
  "#FB923C",
  "#CCBE00",
  "#0086BF",
  "#998E00",
  "#917DB0",
  "#FB923C",
];

export function generateGroupingColor() {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

export function formatDate(
  date: Date,
  dateStyle: "full" | "long" | "medium" | "short" | undefined = "medium",
  timeStyle: "full" | "long" | "medium" | "short" | undefined = "short",
) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle,
    timeStyle,
  }).format(date);
}

export function generateRandomName() {
  return butterflyTypes[Math.floor(Math.random() * butterflyTypes.length)];
}

export function isUUID(uuid: string) {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

export function extractUUIDFromURL(url: string | undefined) {
  const uuid =
    url?.match(
      /\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\./i,
    )?.[1] || null;
  return uuid;
}

export function slugifyWithExtension(str: string) {
  if (!str) return "";

  const inputStr = str.toString();

  const lastDotIndex = inputStr.lastIndexOf(".");

  if (lastDotIndex <= 0 || lastDotIndex === inputStr.length - 1) {
    return inputStr
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "_")
      .replace(/\n/g, "_")
      .replace(/[^a-zA-Z0-9_\u0080-\uFFFF.-]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .replace(/\.{2,}/g, ".");
  }

  const filename = inputStr.substring(0, lastDotIndex);
  const extension = inputStr.substring(lastDotIndex + 1);

  const slugifiedFilename = filename
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/\n/g, "_")
    .replace(/[^a-zA-Z0-9_\u0080-\uFFFF.-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .replace(/\.{2,}/g, ".");

  const slugifiedExtension = extension
    .toLowerCase()
    .trim()
    .replace(/[^a-zA-Z0-9]/g, "");

  return slugifiedExtension
    ? `${slugifiedFilename}.${slugifiedExtension}`
    : slugifiedFilename;
}

export function slugify(str: string, separator = "-") {
  if (!str) return "";
  return str
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s/g, separator)
    .replace(/\n/g, separator)
    .replace(/[^\w-]+/g, "");
}

export function beautifySlug(
  slug: string | null | undefined,
  toUpperCase = true,
): string {
  if (!slug) return "";

  try {
    return slug
      .toString()
      .replace(/_/g, " ")
      .split(/(?=[A-Z][a-z])|(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/)
      .reduce((acc, word) => {
        const addSpace = acc.endsWith("(") ? "" : " ";
        if (!toUpperCase) return `${acc}${addSpace}${word}`;

        const firstChar = word.charAt(0).toUpperCase();
        acc += `${addSpace}${firstChar}${word.slice(1)}`;
        return acc;
      }, "");
  } catch (e) {
    return slug
      .toString()
      .replace(/_/g, " ")
      .split(/(?=[A-Z][a-z])|(?=[A-Z][a-z])/)
      .map((word) => {
        if (!toUpperCase) return word;
        return word.charAt(0).toUpperCase() + word.slice(1);
      })
      .join(" ");
  }
}

export function formatNumber(number: number, decimals = 3, inMillions = false): string {
  if (Number.isNaN(number)) {
    return "N/A";
  }
  if (number === 0) return "0";
  if (number > 1_000_000 || number < -1_000_000) {
    return formatNumberMagnitude(number, decimals, inMillions);
  }

  const value = toFixedString(number, decimals);

  if (number > 1000 || number < -1000) {
    const parts = value.split(".");
    const integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const decimalPart = parts[1] ? `.${parts[1]}` : "";
    return `${integerPart}${decimalPart}`;
  }
  return value;
}

export function formatNumberNoMagnitude(value: number | string) {
  if (typeof value === "string") {
    const suffix = value.replace(/[^a-zA-Z]/g, "").trim();
    const magnitude = ["", "K", "M", "B", "T"].indexOf(suffix.replace(/\s/g, ""));
    value = Number(value.replace(/[^\d.-]/g, "").trim()) * 10 ** (magnitude * 3);
  }

  return value;
}

export function formatNumberThousands(value: number | string): string {
  if (typeof value === "string") {
    value = Number(value);
  }

  if (value > 1000 || value < -1000) {
    const parts = value?.toString().split(".");
    const integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const decimalPart = parts[1] ? `.${parts[1]}` : "";
    return `${integerPart}${decimalPart}`;
  }

  return value?.toString();
}

export function toFixedString(value: number, decimals = 3): string {
  if (!value?.toFixed) return value?.toString();

  if (value % 1 !== 0) {
    if (value < 1 && value > -1) {
      decimals = Math.max(decimals, 2);
    }
    const totalDecimals = value?.toString()?.split(".")[1]?.length || 0;
    const toFixed = Math.min(decimals, totalDecimals);

    const rounded = value?.toFixed(toFixed);
    return rounded?.padEnd(decimals + rounded?.indexOf(".") + 1, "0");
  }
  return value?.toString();
}

export function formatNumberMagnitude(
  value: number | string,
  decimals = 3,
  inMillions = false,
  noSuffix = false,
) {
  if (typeof value === "string") {
    value = Number(formatNumberNoMagnitude(value));
  }

  if (value === 0) return "0";
  if (Number.isNaN(value)) return "N/A";

  value = Number(toFixedString(value, decimals) || 0);

  if (value > 1_000_000 || value < -1_000_000) {
    const magnitude = Math.min(
      inMillions ? 2 : 4,
      Math.floor(Math.log10(Math.abs(value)) / 3),
    );
    const suffix = [" ", "", "M", ...(inMillions ? [] : ["B", "T"])][magnitude];
    const formatted = round(
      value / 10 ** (magnitude * 3),
      Math.min(decimals, 3),
    ).toString();

    const parts = formatted?.toString().split(".");
    const integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const decimalPart = `.${parts[1] || ""}`;
    const formattedNumber = `${integerPart}${decimalPart}`;

    const finalValue = `${formattedNumber?.padEnd(
      Math.min(decimals, 3) + formattedNumber?.indexOf(".") + 1,
      "0",
    )}`;

    return `${finalValue.split(".")?.[1] ? finalValue : finalValue.split(".")?.[0]} ${
      noSuffix ? "" : suffix
    }`;
  }

  if (inMillions && (value > 1_000 || value < -1_000)) {
    const formatted = round(value / 1_000_000, decimals).toString();
    const parts = formatted?.toString().split(".");
    const integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const decimalPart = `.${parts[1] || ""}`;
    const formattedNumber = `${integerPart}${decimalPart}`;

    return `${formattedNumber?.padEnd(
      decimals + formattedNumber?.indexOf(".") + 1,
      "0",
    )} ${noSuffix ? "" : "M"}`;
  }

  return formatNumberThousands(value);
}

const numberRegex = /^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/;
const magnitudeRegex = /^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?[KMBT]$/;

export function parseValue(value: string | number): number | string {
  try {
    if (isDate(value) || typeof value !== "string") return value;

    const parsedValue = value?.replace(/^[$£€¥₹]/, "")?.replace(/[,\s%]/g, "");

    if (parsedValue.match(numberRegex)) {
      return Number.parseFloat(parsedValue);
    }
    if (parsedValue.match(magnitudeRegex)) {
      return formatNumberNoMagnitude(parsedValue);
    }
  } catch (e) {
    console.error(e);
  }

  return value;
}

function exportCanvasFont(size: number, weight?: "bold") {
  const family = `${getComputedStyle(document.documentElement).getPropertyValue("--font-family").trim()}, sans-serif`;
  return weight ? `${weight} ${size}px ${family}` : `${size}px ${family}`;
}

export async function generateReportImage(
  checkIfLoadingData: () => boolean,
  element: HTMLElement | null | undefined,
  name = "report",
  title = "Report",
  showDate = true,
  exportType: "png" | "pdf" = "png",
  darkMode = true,
  onFinish?: () => void,
  onError?: () => void,
) {
  let isDataLoading = checkIfLoadingData();
  while (isDataLoading) {
    await delay(500);
    isDataLoading = checkIfLoadingData();
  }
  await delay(1000);

  const jsPDF = exportType === "pdf" ? (await import("jspdf")).jsPDF : undefined;

  return new Promise<string | null | undefined>((resolve) => {
    if (!element) return null;

    const contentWidth = Math.max(
      element.scrollWidth,
      element.offsetWidth,
      element.clientWidth,
    );
    const contentHeight = Math.max(
      element.scrollHeight,
      element.offsetHeight,
      element.clientHeight,
    );

    toPng(element, {
      width: contentWidth + 16,
      height: contentHeight,
    })
      .then((dataUrl) => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }

        const image = new Image();
        image.onload = () => {
          canvas.width = image.width;
          canvas.height = image.height + 80;

          ctx.fillStyle = darkMode ? "#000000" : "rgb(246, 246, 246)";
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          ctx.fillStyle = "#000000";
          ctx.fillRect(0, 0, canvas.width, 80);

          ctx.font = exportCanvasFont(28);
          ctx.textAlign = "left";
          ctx.fillStyle = "#ffffff";

          ctx.font = exportCanvasFont(28, "bold");
          ctx.fillText(title, 10, 48);

          ctx.font = exportCanvasFont(28);
          const exportString = "| Exported with FINOS Workspace";
          ctx.fillText(exportString, ctx.measureText(title).width + 40, 48);

          const logoSvg = LOGO_SVG;
          const logoImage = new Image();
          logoImage.onload = () => {
            const titleWidth =
              ctx.measureText(title).width + ctx.measureText(exportString).width + 60;
            const logoX = titleWidth;
            const logoY = 48 - 16;
            ctx.drawImage(logoImage, logoX, logoY, 32, 16);

            if (showDate) {
              const currentDate = formatDate(new Date());
              ctx.textAlign = "right";
              ctx.fillText(currentDate, canvas.width - 10, 48);
            }

            ctx.drawImage(image, 0, 80);

            const finalDataUrl =
              exportType === "pdf"
                ? canvas.toDataURL("image/jpeg", 1)
                : canvas.toDataURL();

            if (jsPDF) {
              const pdf = new jsPDF({
                orientation: canvas.width > canvas.height ? "l" : "p",
                unit: "px",
                format: [canvas.width, canvas.height],
              });
              pdf.addImage(finalDataUrl, "JPEG", 0, 0, canvas.width, canvas.height);
              pdf.save(`${name}.pdf`);
            } else {
              const link = document.createElement("a");
              link.download = `${name}.png`;
              link.href = finalDataUrl;
              link.click();
              link.remove();
              resolve(finalDataUrl);
            }
          };

          logoImage.src = `data:image/svg+xml;base64,${btoa(logoSvg)}`;
        };

        image.src = dataUrl;
      })
      .catch((err) => {
        console.log(err);
        onError?.();
        resolve(null);
      })
      .finally(() => {
        onFinish?.();
      });
  });
}

const EXPORT_HEADER_HEIGHT = 80;
const EXPORT_HEADER_FONT_SIZE = 28;
const EXPORT_HEADER_TEXT_Y = 48;
const EXPORT_HEADER_PADDING_LEFT = 10;
const EXPORT_HEADER_PADDING_RIGHT = 10;
const EXPORT_LOGO_WIDTH = 32;
const EXPORT_LOGO_HEIGHT = 16;
const EXPORT_LOGO_Y = 32;
const EXPORT_ELEMENT_PADDING = 16;
const EXPORT_TITLE_LOGO_GAP = 60;

const ELEMENT_POLL_INTERVAL = 100;
const ELEMENT_MAX_WAIT = 5000;
const ELEMENT_SETTLE_DELAY = 1000;

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 277.167 139.248" width="32" height="16" fill="none">
  <path fill="white" d="M147.222,17.667V0h-17.333v17.595H0v52h17.444v-.056h95.111v17.306H16.889v52.278h113.111V17.667h17.222ZM112.556,121.623H34.333v-17.278h78.222v17.278ZM112.556,52.04H17.444v-16.444h95.111v16.444Z"/>
  <path fill="white" d="M147.167,17.72v121.528h113.111v-52.278h-95.667v-17.306h95.111v.056h17.444V17.72h-130ZM242.833,104.47v17.278h-78.222v-17.278h78.222ZM259.722,52.165h-95.111v-16.444h95.111v16.444Z"/>
</svg>`;

async function captureElementWithHeader(
  element: Element,
  title: string,
  darkMode: boolean,
): Promise<HTMLCanvasElement> {
  const contentWidth = Math.max(element.scrollWidth, element.clientWidth);
  const contentHeight = Math.max(element.scrollHeight, element.clientHeight);

  const dataUrl = await toPng(element as HTMLElement, {
    width: contentWidth + EXPORT_ELEMENT_PADDING,
    height: contentHeight,
  });

  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      reject(new Error("Could not get canvas context"));
      return;
    }

    const image = new Image();
    image.onload = () => {
      canvas.width = image.width;
      canvas.height = image.height + EXPORT_HEADER_HEIGHT;

      ctx.fillStyle = darkMode ? "#000000" : "rgb(246, 246, 246)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, canvas.width, EXPORT_HEADER_HEIGHT);

      ctx.font = exportCanvasFont(EXPORT_HEADER_FONT_SIZE, "bold");
      ctx.textAlign = "left";
      ctx.fillStyle = "#ffffff";
      ctx.fillText(title, EXPORT_HEADER_PADDING_LEFT, EXPORT_HEADER_TEXT_Y);

      ctx.font = exportCanvasFont(EXPORT_HEADER_FONT_SIZE);
      const exportString = "| Exported with FINOS Workspace";
      ctx.fillText(
        exportString,
        ctx.measureText(title).width + 40,
        EXPORT_HEADER_TEXT_Y,
      );

      const logoImage = new Image();
      logoImage.onload = () => {
        const titleWidth =
          ctx.measureText(title).width +
          ctx.measureText(exportString).width +
          EXPORT_TITLE_LOGO_GAP;
        ctx.drawImage(
          logoImage,
          titleWidth,
          EXPORT_LOGO_Y,
          EXPORT_LOGO_WIDTH,
          EXPORT_LOGO_HEIGHT,
        );

        const currentDate = formatDate(new Date());
        ctx.textAlign = "right";
        ctx.fillText(
          currentDate,
          canvas.width - EXPORT_HEADER_PADDING_RIGHT,
          EXPORT_HEADER_TEXT_Y,
        );

        ctx.drawImage(image, 0, EXPORT_HEADER_HEIGHT);

        resolve(canvas);
      };
      logoImage.onerror = () => reject(new Error("Failed to load logo"));
      logoImage.src = `data:image/svg+xml;base64,${btoa(LOGO_SVG)}`;
    };
    image.onerror = () => reject(new Error("Failed to load captured image"));
    image.src = dataUrl;
  });
}

function switchTab(tabId: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set("tab", tabId);
  window.history.replaceState({}, "", url.toString());
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForGridLayout(
  maxWait = ELEMENT_MAX_WAIT,
): Promise<HTMLElement | null> {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const element = document.getElementsByClassName("react-grid-layout")[0] as
      | HTMLElement
      | undefined;
    if (element && element.clientHeight > 0) {
      await delay(ELEMENT_SETTLE_DELAY);
      return element;
    }
    await delay(ELEMENT_POLL_INTERVAL);
  }
  return null;
}

export type TabInfo = { id: string; name: string };

export async function generateMultiTabReport(
  checkIfLoadingData: () => boolean,
  tabs: TabInfo[],
  baseTitle: string,
  fileName: string,
  exportType: "png" | "pdf",
  darkMode: boolean,
  onProgress?: (current: number, total: number, tabName: string) => void,
  onFinish?: () => void,
  onError?: (error: Error) => void,
): Promise<void> {
  const originalTab = new URLSearchParams(window.location.search).get("tab");
  const canvases: { name: string; canvas: HTMLCanvasElement }[] = [];

  try {
    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      onProgress?.(i + 1, tabs.length, tab.name);

      switchTab(tab.id);
      const element = await waitForGridLayout(ELEMENT_MAX_WAIT);
      if (!element) {
        throw new Error(`Could not find grid layout for tab: ${tab.name}`);
      }

      let isDataLoading = checkIfLoadingData();
      while (isDataLoading) {
        await delay(500);
        isDataLoading = checkIfLoadingData();
      }
      await delay(1000);

      const title = `${baseTitle} - ${tab.name}`;
      const canvas = await captureElementWithHeader(element, title, darkMode);
      canvases.push({ name: tab.name, canvas });
    }

    if (canvases.length === 0) {
      throw new Error("No content was captured for export. Please try again.");
    }

    if (exportType === "pdf") {
      const { jsPDF } = await import("jspdf");
      const firstCanvas = canvases[0].canvas;
      const pdf = new jsPDF({
        orientation: firstCanvas.width > firstCanvas.height ? "l" : "p",
        unit: "px",
        format: [firstCanvas.width, firstCanvas.height],
      });

      for (let i = 0; i < canvases.length; i++) {
        const { canvas } = canvases[i];
        if (i > 0) {
          pdf.addPage(
            [canvas.width, canvas.height],
            canvas.width > canvas.height ? "l" : "p",
          );
        }
        const dataUrl = canvas.toDataURL("image/jpeg", 1);
        pdf.addImage(dataUrl, "JPEG", 0, 0, canvas.width, canvas.height);
      }

      pdf.save(`${fileName}.pdf`);
    } else {
      const zip = new JSZip();

      for (const { name, canvas } of canvases) {
        const dataUrl = canvas.toDataURL("image/png");
        const base64Data = dataUrl.split(",")[1];
        zip.file(`${slugify(name)}.png`, base64Data, { base64: true });
      }

      const blob = await zip.generateAsync({ type: "blob" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${fileName}.zip`;
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
    }

    onFinish?.();
  } catch (error) {
    onError?.(error instanceof Error ? error : new Error(String(error)));
  } finally {
    if (originalTab) {
      switchTab(originalTab);
    }
  }
}

export type DashboardInfo = {
  id: string;
  name: string;
  tabs: TabInfo[];
};

function navigateToDashboard(dashboardId: string, tabId?: string): void {
  const url = new URL(window.location.href);
  url.pathname = `/app/${dashboardId}`;
  if (tabId) {
    url.searchParams.set("tab", tabId);
  } else {
    url.searchParams.delete("tab");
  }
  window.history.replaceState({}, "", url.toString());
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export async function generateFolderReport(
  checkIfLoadingData: () => boolean,
  dashboards: DashboardInfo[],
  _folderName: string,
  fileName: string,
  exportType: "png" | "pdf",
  exportScope: "current" | "all-tabs",
  darkMode: boolean,
  onProgress?: (
    current: number,
    total: number,
    dashboardName: string,
    tabCurrent?: number,
    tabTotal?: number,
    tabName?: string,
  ) => void,
  onFinish?: () => void,
  onError?: (error: Error) => void,
): Promise<void> {
  const originalPath = window.location.pathname;
  const originalTab = new URLSearchParams(window.location.search).get("tab");
  const zip = new JSZip();

  try {
    for (let i = 0; i < dashboards.length; i++) {
      const dashboard = dashboards[i];
      const dashboardSlug = slugify(dashboard.name);
      const tabTotal = dashboard.tabs.length;
      onProgress?.(i + 1, dashboards.length, dashboard.name, 0, tabTotal);

      navigateToDashboard(dashboard.id, dashboard.tabs[0]?.id);

      if (exportScope === "all-tabs" && dashboard.tabs.length > 1) {
        const canvases: { name: string; canvas: HTMLCanvasElement }[] = [];

        for (let j = 0; j < dashboard.tabs.length; j++) {
          const tab = dashboard.tabs[j];
          onProgress?.(
            i + 1,
            dashboards.length,
            dashboard.name,
            j + 1,
            tabTotal,
            tab.name,
          );

          switchTab(tab.id);
          const element = await waitForGridLayout(ELEMENT_MAX_WAIT);
          if (!element) continue;

          let isDataLoading = checkIfLoadingData();
          while (isDataLoading) {
            await delay(500);
            isDataLoading = checkIfLoadingData();
          }
          await delay(1000);

          const title = `${dashboard.name} - ${tab.name}`;
          const canvas = await captureElementWithHeader(element, title, darkMode);
          canvases.push({ name: tab.name, canvas });
        }

        if (exportType === "pdf") {
          if (canvases.length > 0) {
            const { jsPDF } = await import("jspdf");
            const firstCanvas = canvases[0].canvas;
            const pdf = new jsPDF({
              orientation: firstCanvas.width > firstCanvas.height ? "l" : "p",
              unit: "px",
              format: [firstCanvas.width, firstCanvas.height],
            });

            for (let k = 0; k < canvases.length; k++) {
              const { canvas } = canvases[k];
              if (k > 0) {
                pdf.addPage(
                  [canvas.width, canvas.height],
                  canvas.width > canvas.height ? "l" : "p",
                );
              }
              const dataUrl = canvas.toDataURL("image/jpeg", 1);
              pdf.addImage(dataUrl, "JPEG", 0, 0, canvas.width, canvas.height);
            }

            const pdfBlob = pdf.output("blob");
            zip.file(`${dashboardSlug}.pdf`, pdfBlob);
          }
        } else {
          const dashboardFolder = zip.folder(dashboardSlug);
          for (const { name, canvas } of canvases) {
            const dataUrl = canvas.toDataURL("image/png");
            const base64Data = dataUrl.split(",")[1];
            dashboardFolder?.file(`${slugify(name)}.png`, base64Data, { base64: true });
          }
        }
      } else {
        const element = await waitForGridLayout(ELEMENT_MAX_WAIT);
        if (!element) continue;

        let isDataLoading = checkIfLoadingData();
        while (isDataLoading) {
          await delay(500);
          isDataLoading = checkIfLoadingData();
        }
        await delay(1000);

        const tabName = dashboard.tabs[0]?.name || "";
        const title = tabName ? `${dashboard.name} - ${tabName}` : dashboard.name;
        const canvas = await captureElementWithHeader(element, title, darkMode);

        if (exportType === "pdf") {
          const { jsPDF } = await import("jspdf");
          const pdf = new jsPDF({
            orientation: canvas.width > canvas.height ? "l" : "p",
            unit: "px",
            format: [canvas.width, canvas.height],
          });
          const dataUrl = canvas.toDataURL("image/jpeg", 1);
          pdf.addImage(dataUrl, "JPEG", 0, 0, canvas.width, canvas.height);
          const pdfBlob = pdf.output("blob");
          zip.file(`${dashboardSlug}.pdf`, pdfBlob);
        } else {
          const dataUrl = canvas.toDataURL("image/png");
          const base64Data = dataUrl.split(",")[1];
          zip.file(`${dashboardSlug}.png`, base64Data, { base64: true });
        }
      }
    }

    const blob = await zip.generateAsync({ type: "blob" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${fileName}.zip`;
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);

    onFinish?.();
  } catch (error) {
    onError?.(error instanceof Error ? error : new Error(String(error)));
  } finally {
    const dashboardId = originalPath.split("/app/")[1];
    if (dashboardId) {
      navigateToDashboard(dashboardId, originalTab || undefined);
    } else {
      window.history.replaceState({}, "", originalPath);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  }
}

export function isLight(color: string) {
  try {
    const r = Number.parseInt(color.slice(1, 3), 16) / 255;
    const g = Number.parseInt(color.slice(3, 5), 16) / 255;
    const b = Number.parseInt(color.slice(5, 7), 16) / 255;

    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;

    return luminance > 0.5;
  } catch (_err) {
    return false;
  }
}

export function hexToRGBString(hex: string, alpha?: number): string {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);

  if (alpha !== undefined) {
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return `rgb(${r}, ${g}, ${b})`;
}

export function getRandomUserListBackgroundByEmail(email: string) {
  const COLORS = [
    "#00B5E2",
    "#6D5296",
    "#22C55E",
    "#CCBE00",
    "#F97316",
    "#E93361",
    "#005E8A",
  ];

  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = email.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % COLORS.length;
  return COLORS[index];
}

export function ensureArray<T>(value: T | T[], defaultValue: T[] = []): T[] {
  if (value === null || value === undefined) return defaultValue;

  if (typeof value === "string") {
    return value
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean) as T[];
  }
  return Array.isArray(value) ? value : [value];
}

export function ensureString<T>(value: T | T[]): string {
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  return value?.toString() || "";
}

export function scoreArrays<T>(
  arr1: T[],
  arr2: T[],
  iterSmArray = false,
): { score: number; matches: T[] } {
  if (!areTruthy(arr1, arr2)) return { score: 0, matches: [] };

  let score = 0;
  const matches: T[] = [];
  const [smArray, lgArray] = [arr1, arr2].sort((a, b) =>
    iterSmArray ? b.length - a.length : a.length - b.length,
  );

  for (const element of lgArray) {
    if (smArray.includes(element) && !matches.includes(element)) {
      score++;
      matches.push(element);
    }
  }

  return { score: score / lgArray.length, matches };
}

function mergeObjects<T, U>(target: T, source: U, withFunctions = false): T & U {
  try {
    const into = target as Record<string, unknown>;
    const from = (source || {}) as Record<string, unknown>;
    const sourceKeys = Object.keys(from);

    for (const key of Object.keys(from)) {
      let removeKey = false;
      if (typeof from[key] === "object" && !Array.isArray(from[key])) {
        if (!into?.[key]) Object.assign(into, { [key]: {} });

        Object.assign(
          into[key] as object,
          mergeObjects(into[key], from[key], withFunctions),
        );
        removeKey = true;
      }
      if (Array.isArray(from[key])) {
        Object.assign(into, { [key]: from[key] });
        removeKey = true;
      }

      removeKey && sourceKeys.splice(sourceKeys.indexOf(key), 1);
    }

    for (const key of sourceKeys) {
      if (typeof from[key] !== "object") {
        if (typeof from[key] !== "function" || withFunctions) {
          Object.assign(into, { [key]: from[key] });
        }
      }
    }

    return target as T & U;
  } catch (e) {
    console.log(`Error in mergeObjects: ${e}`);
    return (target || {}) as T & U;
  }
}

export const formatFileSize = (bytes: number, decimalCases = 0): string => {
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(decimalCases)}${units[unitIndex]}`;
};

export function ensureUniqueSlug(
  base: string,
  isSlugUnique: (slug: string) => boolean,
): string {
  if (isSlugUnique(base)) return base;
  for (let i = 2; ; i++) {
    const suffix = `-${i}`;
    const candidate = `${base.slice(0, MAX_SKILL_SLUG_LENGTH - suffix.length)}${suffix}`;
    if (isSlugUnique(candidate)) return candidate;
  }
}
