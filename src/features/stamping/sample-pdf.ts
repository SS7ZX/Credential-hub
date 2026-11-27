import { PDFDocument } from 'pdf-lib'
import {
  inspectPdfTemplate,
  MAX_STAMP_PDF_BYTES,
  PdfTemplateError,
  validatePdfFileType,
} from './pdf-template'
import type { PageDimensions } from './layout'

const A4_LANDSCAPE_WIDTH_POINTS = 841.89
const A4_LANDSCAPE_HEIGHT_POINTS = 595.28

export type PreparedSamplePdf = {
  bytes: Uint8Array
  pages: PageDimensions[]
}

type SampleImageFile = Pick<File, 'size' | 'type' | 'arrayBuffer'>

export async function prepareSamplePdf(file: SampleImageFile): Promise<PreparedSamplePdf> {
  if (file.size > MAX_STAMP_PDF_BYTES) {
    throw new PdfTemplateError('too_large', 'Sample files must be 15 MB or smaller.')
  }

  let bytes: Uint8Array
  if (file.type === 'application/pdf') {
    validatePdfFileType(file.type)
    bytes = new Uint8Array(await file.arrayBuffer())
  } else if (file.type === 'image/png' || file.type === 'image/jpeg') {
    bytes = await imageToA4Pdf(file)
  } else {
    throw new PdfTemplateError('invalid_mime', 'Choose a PDF, PNG, or JPEG sample.')
  }

  if (bytes.byteLength > MAX_STAMP_PDF_BYTES) {
    throw new PdfTemplateError('too_large', 'The prepared sample PDF exceeds 15 MB.')
  }
  const pages = await inspectPdfTemplate(bytes)
  if (!pages.length) throw new PdfTemplateError('pdf_invalid', 'The PDF has no pages.')
  if (pages.some((page) => page.rotation !== 0)) {
    throw new PdfTemplateError('pdf_rotated', 'Rotated PDFs are not supported. Use an unrotated source file.')
  }
  return { bytes, pages }
}

async function imageToA4Pdf(file: SampleImageFile): Promise<Uint8Array> {
  const imageBytes = new Uint8Array(await file.arrayBuffer())
  const document = await PDFDocument.create()
  try {
    const image = file.type === 'image/png'
      ? await document.embedPng(imageBytes)
      : await document.embedJpg(imageBytes)
    const page = document.addPage([A4_LANDSCAPE_WIDTH_POINTS, A4_LANDSCAPE_HEIGHT_POINTS])
    const scale = Math.min(
      A4_LANDSCAPE_WIDTH_POINTS / image.width,
      A4_LANDSCAPE_HEIGHT_POINTS / image.height,
    )
    const width = image.width * scale
    const height = image.height * scale
    page.drawImage(image, {
      x: (A4_LANDSCAPE_WIDTH_POINTS - width) / 2,
      y: (A4_LANDSCAPE_HEIGHT_POINTS - height) / 2,
      width,
      height,
    })
    return await document.save({ useObjectStreams: true })
  } catch {
    throw new PdfTemplateError('image_invalid', 'The image could not be converted to an A4 landscape PDF.')
  }
}
