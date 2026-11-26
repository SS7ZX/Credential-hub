import { PDFDocument } from 'pdf-lib'
import type { PageDimensions } from './layout'

export const MAX_STAMP_PDF_BYTES = 15 * 1024 * 1024

export class PdfTemplateError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'PdfTemplateError'
    this.code = code
  }
}

export function validatePdfFileType(mimeType: string): void {
  if (mimeType !== 'application/pdf') {
    throw new PdfTemplateError('invalid_mime', 'Only application/pdf files are accepted.')
  }
}

export async function inspectPdfTemplate(bytes: Uint8Array): Promise<PageDimensions[]> {
  if (bytes.byteLength > MAX_STAMP_PDF_BYTES) {
    throw new PdfTemplateError('too_large', 'PDF files must be 15 MB or smaller.')
  }
  if (!startsWithPdfHeader(bytes)) {
    throw new PdfTemplateError('not_pdf', 'The selected file is not a valid PDF.')
  }

  const sourceText = new TextDecoder('latin1').decode(bytes)
  if (/\/ByteRange\s*\[|\/Type\s*\/Sig\b/.test(sourceText)) {
    throw new PdfTemplateError('pdf_signed', 'Digitally signed PDFs cannot be stamped.')
  }
  if (/\/Encrypt\b/.test(sourceText)) {
    throw new PdfTemplateError('pdf_encrypted', 'Encrypted PDFs cannot be stamped.')
  }

  let document: PDFDocument
  try {
    document = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false })
  } catch {
    throw new PdfTemplateError('pdf_invalid', 'The PDF could not be opened or is encrypted.')
  }

  return document.getPages().map((page) => {
    const { width, height } = page.getSize()
    return { width, height, rotation: page.getRotation().angle }
  })
}

function startsWithPdfHeader(bytes: Uint8Array): boolean {
  return bytes.length >= 5
    && bytes[0] === 0x25
    && bytes[1] === 0x50
    && bytes[2] === 0x44
    && bytes[3] === 0x46
    && bytes[4] === 0x2d
}
