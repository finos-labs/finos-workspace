import { describe, it } from "node:test";
import { expect } from "expect";
import { assertSafeZip, UnsafeZipError } from "../../../../src/lib/zip-guard.ts";
import { makeXlsx } from "../../../helpers/make-xlsx.ts";
import { makeZip } from "../../../helpers/make-zip.ts";
import { below, seeded } from "../../../helpers/rng.ts";

const refuses = (bytes: Uint8Array) => {
  try {
    assertSafeZip(bytes);
    return null;
  } catch (e) {
    return e instanceof UnsafeZipError ? e.message : `WRONG ERROR: ${String(e)}`;
  }
};

describe("assertSafeZip", () => {
  it("accepts a real spreadsheet", async () => {
    expect(refuses(await makeXlsx([{ a: 1 }, { a: 2 }]))).toBeNull();
  });

  it("accepts a zip of ordinary small parts", () => {
    expect(refuses(makeZip([{ name: "a.xml", data: new TextEncoder().encode("<a/>".repeat(1000)) }, { name: "b.xml", data: new Uint8Array(500) }]))).toBeNull();
  });

  it("refuses what is not a zip", () => {
    expect(refuses(new TextEncoder().encode("this is just text, long enough to hold a header record: ".repeat(3)))).toContain("not a ZIP");
    expect(refuses(new Uint8Array(0))).toContain("not a ZIP");
    expect(refuses(new Uint8Array(10))).toContain("not a ZIP");
  });

  it("refuses a real bomb: 90 MB of zeros that fit in a few kilobytes", () => {
    const bomb = makeZip([{ name: "xl/worksheets/sheet1.xml", data: new Uint8Array(90 * 1024 * 1024) }]);
    expect(bomb.length).toBeLessThan(200 * 1024);
    expect(refuses(bomb)).toContain("far more than its size");
  });

  it("refuses a part that claims to unpack to more than is allowed", () => {
    expect(refuses(makeZip([{ name: "a", data: new Uint8Array(10), unpackedSize: 600 * 1024 * 1024, packedSize: 500 * 1024 * 1024 }]))).toContain("more than is allowed");
  });

  it("refuses parts that are each modest and together too many bytes", () => {
    const entries = Array.from({ length: 6 }, (_, i) => ({ name: `p${i}`, data: new Uint8Array(1), unpackedSize: 60 * 1024 * 1024, packedSize: 30 * 1024 * 1024 }));
    expect(refuses(makeZip(entries))).toContain("unpacks to more than is allowed");
  });

  it("refuses a file with more parts than a document has", () => {
    const entries = Array.from({ length: 5_001 }, (_, i) => ({ name: `p${i}`, data: new Uint8Array(1) }));
    expect(refuses(makeZip(entries))).toContain("parts");
  });

  it("refuses ZIP64, which nothing it reads needs", () => {
    const zip = makeZip([{ name: "a", data: new Uint8Array(10), unpackedSize: 0xffffffff }]);
    expect(refuses(zip)).toContain("ZIP64");
  });

  it("refuses a directory that points outside the file", () => {
    const zip = makeZip([{ name: "a", data: new Uint8Array(10) }]);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    view.setUint32(zip.length - 22 + 16, 0x7fffffff, true); // directory offset
    expect(refuses(zip)).toContain("damaged");
  });

  it("never fails in any way but a refusal, whatever is done to a valid file", async () => {
    const good = await makeXlsx(Array.from({ length: 20 }, (_, i) => ({ a: i, b: `text ${i}` })));
    const random = seeded(12345);
    const next = (n: number) => below(random, n);
    for (let round = 0; round < 3_000; round++) {
      const bytes = Uint8Array.from(good);
      for (let k = 0; k < 1 + next(6); k++) bytes[next(bytes.length)] = next(256);
      const cut = next(4) === 0 ? bytes.subarray(0, next(bytes.length)) : bytes;
      const result = refuses(cut);
      expect(result === null || !result.startsWith("WRONG ERROR")).toBe(true);
    }
  });
});
