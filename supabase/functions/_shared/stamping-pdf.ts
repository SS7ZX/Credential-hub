import {
  PDFDocument,
  PDFName,
  StandardFonts,
  rgb,
} from "npm:pdf-lib@1.17.1";
import QRCode from "npm:qrcode@1.5.4";

export const MAX_STAMP_PDF_BYTES = 15 * 1024 * 1024;
const QUIET_ZONE_MODULES = 4;
const LABEL_GAP_POINTS = 4;
const LABEL_WIDTH_POINTS = 132;
const LABEL_FONT_SIZE = 7;
const LABEL_LINE_HEIGHT = 8;

export type QrLayout = {
  page_number: number;
  x_points: number;
  y_points: number;
  size_points: number;
  expected_page_width_points: number;
  expected_page_height_points: number;
  page_size_tolerance_points: number;
};

export class StampPdfError extends Error {
  constructor(
    readonly code:
      | "pdf_invalid"
      | "pdf_encrypted"
      | "pdf_signed"
      | "pdf_rotated"
      | "page_limit"
      | "page_size_mismatch"
      | "qr_stamping_failed",
  ) {
    super(code);
    this.name = "StampPdfError";
  }
}

export type StampedPdf = {
  bytes: Uint8Array;
  sourceSha256: string;
  outputSha256: string;
  pageCount: number;
};

export async function stampPdf(
  source: Uint8Array,
  verifyUrl: string,
  credentialId: string,
  serialNumber: string,
  layout: QrLayout,
  maxPageCount: number,
): Promise<StampedPdf> {
  if (source.byteLength === 0 || source.byteLength > MAX_STAMP_PDF_BYTES) {
    throw new StampPdfError("pdf_invalid");
  }
  const raw = new TextDecoder("latin1").decode(source);
  if (/\/ByteRange\s*\[|\/Type\s*\/Sig\b/.test(raw)) throw new StampPdfError("pdf_signed");
  if (/\/Encrypt\b/.test(raw)) throw new StampPdfError("pdf_encrypted");
  if (!raw.startsWith("%PDF-")) throw new StampPdfError("pdf_invalid");
  if (!/^https:\/\//.test(verifyUrl) || !/\/verify\/[0-9a-f-]{36}$/.test(verifyUrl)) {
    throw new StampPdfError("qr_stamping_failed");
  }
  if (!Number.isInteger(maxPageCount) || maxPageCount < 1 || maxPageCount > 100) {
    throw new Error("Stamping page limit is not configured correctly");
  }

  let document: PDFDocument;
  try {
    document = await PDFDocument.load(source, { ignoreEncryption: false, updateMetadata: false });
  } catch {
    throw new StampPdfError("pdf_invalid");
  }
  const pages = document.getPages();
  if (!pages.length) throw new StampPdfError("pdf_invalid");
  if (pages.length > maxPageCount) throw new StampPdfError("page_limit");
  if (pages.some((page) => page.getRotation().angle !== 0)) throw new StampPdfError("pdf_rotated");

  const targetIndex = layout.page_number - 1;
  const target = pages[targetIndex];
  if (!target || !Number.isInteger(layout.page_number)) throw new StampPdfError("qr_stamping_failed");

  for (const page of pages) {
    const { width, height } = page.getSize();
    if (
      Math.abs(width - layout.expected_page_width_points) > layout.page_size_tolerance_points
      || Math.abs(height - layout.expected_page_height_points) > layout.page_size_tolerance_points
    ) throw new StampPdfError("page_size_mismatch");
  }

  const { width, height } = target.getSize();
  if (
    layout.size_points < 25 * 72 / 25.4
    || layout.size_points > 30 * 72 / 25.4
    || layout.x_points < 0
    || layout.y_points < 0
    || layout.x_points + layout.size_points > width
    || layout.y_points + layout.size_points > height
    || layout.x_points + layout.size_points + LABEL_GAP_POINTS + LABEL_WIDTH_POINTS > width
  ) throw new StampPdfError("qr_stamping_failed");

  const qr = QRCode.create(verifyUrl, { errorCorrectionLevel: "Q" });
  const qrSize = qr.modules.size;
  const moduleSize = layout.size_points / (qrSize + QUIET_ZONE_MODULES * 2);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const labels = wrapLabel(`Serial ${serialNumber}`, font, LABEL_FONT_SIZE, LABEL_WIDTH_POINTS);
  const allLabels = [`ID ${credentialId.slice(0, 8)}`, ...labels];
  if (allLabels.length * LABEL_LINE_HEIGHT > layout.size_points) {
    throw new StampPdfError("qr_stamping_failed");
  }

  target.drawRectangle({
    x: layout.x_points,
    y: layout.y_points,
    width: layout.size_points,
    height: layout.size_points,
    color: rgb(1, 1, 1),
  });
  for (let row = 0; row < qrSize; row += 1) {
    for (let column = 0; column < qrSize; column += 1) {
      if (!qr.modules.data[row * qrSize + column]) continue;
      target.drawRectangle({
        x: layout.x_points + (QUIET_ZONE_MODULES + column) * moduleSize,
        y: layout.y_points + (QUIET_ZONE_MODULES + qrSize - row - 1) * moduleSize,
        width: moduleSize,
        height: moduleSize,
        color: rgb(0, 0, 0),
      });
    }
  }

  const labelX = layout.x_points + layout.size_points + LABEL_GAP_POINTS;
  const labelTop = layout.y_points + layout.size_points - LABEL_FONT_SIZE;
  allLabels.forEach((text, index) => {
    target.drawText(text, {
      x: labelX,
      y: labelTop - index * LABEL_LINE_HEIGHT,
      size: LABEL_FONT_SIZE,
      font,
      color: rgb(0.08, 0.12, 0.1),
    });
  });

  document.setTitle("");
  document.setAuthor("");
  document.setSubject("");
  document.setKeywords([]);
  document.setCreator("Credential Hub");
  document.setProducer("Credential Hub");
  document.catalog.delete(PDFName.of("Metadata"));

  const output = await document.save({ useObjectStreams: true });
  const outputSha256 = await sha256(output);
  return {
    bytes: output,
    sourceSha256: await sha256(source),
    outputSha256,
    pageCount: pages.length,
  };
}

function wrapLabel(
  value: string,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  fontSize: number,
  width: number,
): string[] {
  const words = value.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, fontSize) <= width) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = "";
    for (const character of word) {
      const next = `${line}${character}`;
      if (font.widthOfTextAtSize(next, fontSize) > width && line) {
        lines.push(line);
        line = character;
      } else {
        line = next;
      }
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
