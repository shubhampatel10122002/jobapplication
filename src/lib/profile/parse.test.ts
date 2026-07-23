import { describe, expect, it } from "vitest";
import { extractPdfText } from "./parse";

/** Minimal one-page PDF with the text "Hello JobPilot". */
function minimalPdf(): Uint8Array {
  const content = "BT /F1 24 Tf 100 700 Td (Hello JobPilot) Tj ET";
  const objects = [
    "1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n",
    "2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n",
    "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj\n",
    `4 0 obj<< /Length ${content.length} >>stream\n${content}\nendstream\nendobj\n`,
    "5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n",
  ];
  let body = "%PDF-1.1\n";
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(body));
    body += obj;
  }
  const xrefStart = Buffer.byteLength(body);
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  body += xref;
  body += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(body));
}

describe("extractPdfText", () => {
  it("does not detach the caller's buffer (so resume can still be written to disk)", async () => {
    const bytes = minimalPdf();
    const shared = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    expect(shared.byteLength).toBeGreaterThan(0);

    await extractPdfText(shared);

    // Detached ArrayBuffers throw on Construct / Buffer.from.
    expect(() => new Uint8Array(shared)).not.toThrow();
    expect(() => Buffer.from(shared)).not.toThrow();
    expect(Buffer.from(shared).byteLength).toBe(shared.byteLength);
  });
});
