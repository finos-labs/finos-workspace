import ExcelJS from "exceljs";
import { getLogger } from "../lib/logger.ts";
import { assertSafeZip } from "../lib/zip-guard.ts";

const logger = getLogger(["app", "widgets", "xlsx"]);

const MAX_SHEET_ROWS = 100_000;
const MAX_SHEET_COLUMNS = 200;

type SheetValue = string | number | boolean | null;

function sheetValue(value: ExcelJS.CellValue | undefined): SheetValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") return value;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if ("richText" in value) return value.richText.map((part) => part.text).join("");
  if ("formula" in value || "sharedFormula" in value) return sheetValue((value as { result?: ExcelJS.CellValue }).result);
  if ("text" in value) return sheetValue(value.text as ExcelJS.CellValue);
  if ("error" in value) return null;
  return null;
}

export async function xlsxToJsonText(buf: Buffer): Promise<string> {
  assertSafeZip(buf);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buf as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 1) return "[]";

  const width = Math.min(sheet.columnCount, MAX_SHEET_COLUMNS);
  const headings: string[] = [];
  const used = new Set<string>();
  for (let col = 1; col <= width; col++) {
    const heading = sheetValue(sheet.getRow(1).getCell(col).value);
    const base = heading === null || heading === "" ? `column_${col}` : String(heading);
    let name = base;
    for (let n = 1; used.has(name); n++) name = `${base}_${n}`;
    used.add(name);
    headings.push(name);
  }

  const rows: Record<string, SheetValue>[] = [];
  const last = Math.min(sheet.rowCount, MAX_SHEET_ROWS + 1);
  for (let r = 2; r <= last; r++) {
    const row = sheet.getRow(r);
    const out: Record<string, SheetValue> = {};
    let any = false;
    for (let col = 1; col <= width; col++) {
      const value = sheetValue(row.getCell(col).value);
      if (value !== null && value !== "") any = true;
      out[headings[col - 1]] = value;
    }
    if (any) rows.push(out);
  }
  if (sheet.rowCount > last) logger.warn("Spreadsheet has more rows than are read", { rows: sheet.rowCount, read: MAX_SHEET_ROWS });
  return JSON.stringify(rows);
}
