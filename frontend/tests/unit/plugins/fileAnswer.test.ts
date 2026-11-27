import { describe, expect, it } from "vitest";
import { fileAnswerOf, fileNameOf, toBase64 } from "~/plugins/fileAnswer";

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let next = 0;
  return new ReadableStream({
    pull(controller) {
      if (next >= chunks.length) controller.close();
      else controller.enqueue(chunks[next++]);
    },
  });
}

describe("a file answer", () => {
  it("names the file from Content-Disposition, else from the URL, and keeps the name safe", () => {
    expect(
      fileNameOf('attachment; filename="positions.xlsx"', "https://b.example/x"),
    ).toBe("positions.xlsx");
    expect(fileNameOf("attachment; filename = trades.csv", "https://b.example/x")).toBe(
      "trades.csv",
    );
    expect(
      fileNameOf(
        "attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.csv",
        "https://b.example/x",
      ),
    ).toBe("résumé.csv");
    expect(
      fileNameOf(
        "attachment; filename=\"fallback.csv\"; filename*=UTF-8''%E0%A4%A",
        "https://b.example/x",
      ),
    ).toBe("fallback.csv");
    expect(fileNameOf(null, "https://b.example/files/trades.parquet?v=2")).toBe(
      "trades.parquet",
    );
    expect(fileNameOf('attachment; filename="../../etc/passwd"', "/x")).toBe("passwd");
    expect(fileNameOf('attachment; filename="a<script>.csv"', "/x")).toBe(
      "a_script_.csv",
    );
    expect(fileNameOf(null, "https://b.example/")).toBe("file");
  });

  it("encodes the bytes as base64", () => {
    expect(toBase64(new Uint8Array([1, 2, 3, 250]))).toBe("AQID+g==");
    const big = new Uint8Array(100_000).fill(65);
    expect(atob(toBase64(big)).length).toBe(100_000);
  });

  it("reads an answer as { file: { name, mime, base64 } }", async () => {
    const response = new Response(new Uint8Array([104, 105]), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="t.csv"',
      },
    });
    await expect(fileAnswerOf(response, "https://b.example/t")).resolves.toEqual({
      file: { name: "t.csv", mime: "text/csv", base64: "aGk=" },
    });
  });

  it("joins the chunks of a streamed answer", async () => {
    const response = new Response(
      streamOf([new Uint8Array([104]), new Uint8Array([105, 33])]),
    );
    await expect(
      fileAnswerOf(response, "https://b.example/files/t.bin"),
    ).resolves.toEqual({
      file: { name: "t.bin", mime: "application/octet-stream", base64: "aGkh" },
    });
  });
});
