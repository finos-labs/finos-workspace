import ExcelJS from "exceljs";

export async function makeXlsx(rows: Record<string, unknown>[], sheetName = "Sheet1"): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  if (rows.length > 0) {
    const headings = Object.keys(rows[0]);
    sheet.addRow(headings);
    for (const row of rows) sheet.addRow(headings.map((h) => row[h] as ExcelJS.CellValue));
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
