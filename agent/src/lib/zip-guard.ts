interface ZipLimits {
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
  maxRatio: number;
}

const OFFICE_ZIP_LIMITS: ZipLimits = {
  maxEntries: 5_000,
  maxEntryBytes: 100 * 1024 * 1024,
  maxTotalBytes: 250 * 1024 * 1024,
  maxRatio: 200,
};

export class UnsafeZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeZipError";
  }
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const ZIP64_MARK = 0xffffffff;

export function assertSafeZip(bytes: Uint8Array, limits: ZipLimits = OFFICE_ZIP_LIMITS): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 22) throw new UnsafeZipError("This is not a ZIP file.");

  let eocd = -1;
  for (let i = bytes.byteLength - 22; i >= Math.max(0, bytes.byteLength - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new UnsafeZipError("This is not a ZIP file.");

  const entryCount = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  if (entryCount === 0xffff || directorySize === ZIP64_MARK || directoryOffset === ZIP64_MARK) {
    throw new UnsafeZipError("ZIP64 files are not read.");
  }
  if (entryCount > limits.maxEntries) throw new UnsafeZipError(`The file has ${entryCount} parts, more than the ${limits.maxEntries} allowed.`);
  if (directoryOffset + directorySize > eocd) throw new UnsafeZipError("The ZIP directory is damaged.");

  let at = directoryOffset;
  let total = 0;
  for (let n = 0; n < entryCount; n++) {
    if (at + 46 > bytes.byteLength || view.getUint32(at, true) !== CENTRAL_SIGNATURE) throw new UnsafeZipError("The ZIP directory is damaged.");
    const packed = view.getUint32(at + 20, true);
    const unpacked = view.getUint32(at + 24, true);
    if (packed === ZIP64_MARK || unpacked === ZIP64_MARK) throw new UnsafeZipError("ZIP64 files are not read.");
    if (unpacked > limits.maxEntryBytes) throw new UnsafeZipError("A part of the file unpacks to more than is allowed.");
    if (unpacked > 1024 * 1024 && unpacked / Math.max(1, packed) > limits.maxRatio) {
      throw new UnsafeZipError("A part of the file unpacks to far more than its size: it is not read.");
    }
    total += unpacked;
    if (total > limits.maxTotalBytes) throw new UnsafeZipError("The file unpacks to more than is allowed.");
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    at += 46 + nameLength + extraLength + commentLength;
  }
}
