import { PDFDocument, degrees } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { inspectPdfTemplate, PdfTemplateError, validatePdfFileType } from './pdf-template'

describe('PDF template inspection', () => {
  it('returns page dimensions and rotation without changing the source', async () => {
    const document = await PDFDocument.create()
    document.addPage([841.89, 595.28])
    const bytes = await document.save()

    await expect(inspectPdfTemplate(bytes)).resolves.toEqual([
      { width: 841.89, height: 595.28, rotation: 0 },
    ])
    expect(document.getPages()[0].getRotation().angle).toBe(0)
  })

  it('rejects invalid MIME, digitally signed, and invalid PDF inputs explicitly', async () => {
    expect(() => validatePdfFileType('application/octet-stream')).toThrow(PdfTemplateError)
    await expect(inspectPdfTemplate(new TextEncoder().encode('%PDF-1.7\n/ByteRange [0 1 2 3]')))
      .rejects.toMatchObject({ code: 'pdf_signed' })
    await expect(inspectPdfTemplate(new TextEncoder().encode('not a PDF')))
      .rejects.toMatchObject({ code: 'not_pdf' })
  })

  it('reports the rotation of a rotated source page', async () => {
    const document = await PDFDocument.create()
    document.addPage([841.89, 595.28]).setRotation(degrees(90))
    await expect(inspectPdfTemplate(await document.save())).resolves.toEqual([
      { width: 841.89, height: 595.28, rotation: 90 },
    ])
  })
})
