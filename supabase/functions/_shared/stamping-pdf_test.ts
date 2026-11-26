import { PDFDocument, PDFName, degrees } from "npm:pdf-lib@1.17.1";
import { stampPdf, StampPdfError, type QrLayout } from "./stamping-pdf.ts";

const layout: QrLayout = {
  page_number: 1,
  x_points: 30,
  y_points: 30,
  size_points: 79.37,
  expected_page_width_points: 841.89,
  expected_page_height_points: 595.28,
  page_size_tolerance_points: 1,
};
const verifyUrl = "https://example.test/verify/00000000-0000-4000-8000-000000000000";

async function sourcePdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.addPage([841.89, 595.28]);
  document.setTitle("private.recipient@example.test");
  document.setAuthor("Private Recipient");
  return await document.save();
}

Deno.test("stamping preserves page dimensions, strips Info/XMP metadata, and hashes both PDFs", async () => {
  const output = await stampPdf(
    await sourcePdf(),
    verifyUrl,
    "00000000-0000-4000-8000-000000000000",
    "SAMPLE-001",
    layout,
    20,
  );
  const stamped = await PDFDocument.load(output.bytes);
  const page = stamped.getPages()[0];

  if (output.pageCount !== 1 || page.getWidth() !== 841.89 || page.getHeight() !== 595.28) {
    throw new Error("Stamped PDF page dimensions changed");
  }
  if (stamped.getTitle() || stamped.getAuthor() || stamped.getSubject()) {
    throw new Error("Stamped PDF retained private Info metadata");
  }
  if (stamped.catalog.get(PDFName.of("Metadata"))) {
    throw new Error("Stamped PDF retained XMP metadata");
  }
  if (!/^[0-9a-f]{64}$/.test(output.sourceSha256) || !/^[0-9a-f]{64}$/.test(output.outputSha256)) {
    throw new Error("Source or output hash is invalid");
  }
  const pdfText = new TextDecoder("latin1").decode(output.bytes);
  if (pdfText.includes("private.recipient@example.test") || pdfText.includes("Private Recipient")) {
    throw new Error("Recipient data was retained in the output PDF");
  }
});

Deno.test("stamping rejects signed, encrypted, rotated, oversized-page-count, and unexpected-size PDFs", async () => {
  const base = await sourcePdf();
  const withSignature = new Uint8Array([...base, ...new TextEncoder().encode("\n/ByteRange [0 1 2 3]")]);
  await assertStampError(withSignature, layout, "pdf_signed");

  const rotatedDocument = await PDFDocument.create();
  rotatedDocument.addPage([841.89, 595.28]).setRotation(degrees(90));
  await assertStampError(await rotatedDocument.save(), layout, "pdf_rotated");

  await assertStampError(base, { ...layout, expected_page_width_points: 700 }, "page_size_mismatch");
  const manyPages = await PDFDocument.create();
  manyPages.addPage([841.89, 595.28]);
  manyPages.addPage([841.89, 595.28]);
  await assertStampError(await manyPages.save(), layout, "page_limit", 1);

  const encryptedMarker = new Uint8Array([...base, ...new TextEncoder().encode("\n/Encrypt 1 0 R")]);
  await assertStampError(encryptedMarker, layout, "pdf_encrypted");
});

async function assertStampError(
  bytes: Uint8Array,
  nextLayout: QrLayout,
  expectedCode: string,
  maxPages = 20,
): Promise<void> {
  try {
    await stampPdf(
      bytes,
      verifyUrl,
      "00000000-0000-4000-8000-000000000000",
      "SAMPLE-001",
      nextLayout,
      maxPages,
    );
  } catch (error) {
    if (error instanceof StampPdfError && error.code === expectedCode) return;
    throw error;
  }
  throw new Error(`Expected stamp error ${expectedCode}`);
}
