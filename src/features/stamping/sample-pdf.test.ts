import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { prepareSamplePdf } from './sample-pdf'
import { inspectPdfTemplate } from './pdf-template'

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/rWQAAAAASUVORK5CYII=',
  'base64',
)

describe('stamping sample preparation', () => {
  it('converts an image background to a one-page A4 landscape PDF', async () => {
    const file = new Blob([onePixelPng], { type: 'image/png' })
    const sample = await prepareSamplePdf(file)

    expect(sample.pages).toHaveLength(1)
    expect(sample.pages[0].width).toBeCloseTo(841.89, 1)
    expect(sample.pages[0].height).toBeCloseTo(595.28, 1)
    await expect(inspectPdfTemplate(sample.bytes)).resolves.toHaveLength(1)
  })

  it('preserves page dimensions for PDF backgrounds', async () => {
    const document = await PDFDocument.create()
    document.addPage([612, 792])
    const pdfBytes = await document.save()
    const pdfBuffer = new ArrayBuffer(pdfBytes.byteLength)
    new Uint8Array(pdfBuffer).set(pdfBytes)
    const file = new Blob([pdfBuffer], { type: 'application/pdf' })

    const sample = await prepareSamplePdf(file)
    expect(sample.pages[0]).toEqual({ width: 612, height: 792, rotation: 0 })
  })

  it('rejects unsupported image types', async () => {
    const file = new Blob(['not a certificate'], { type: 'image/webp' })
    await expect(prepareSamplePdf(file)).rejects.toMatchObject({ code: 'invalid_mime' })
  })
})
