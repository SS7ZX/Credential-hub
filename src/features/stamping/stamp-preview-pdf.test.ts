import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { QR_SIZE_DEFAULT_POINTS } from './layout'
import { createScanTestPdf } from './stamp-preview-pdf'

const credentialId = '80000000-0000-4000-8000-000000000001'
const layout = {
  pageNumber: 1,
  x: 24,
  y: 30,
  size: QR_SIZE_DEFAULT_POINTS,
  pageWidth: 841.89,
  pageHeight: 595.28,
  tolerance: 1,
}

describe('scan-test PDF generation', () => {
  it('creates a printable PDF with a real credential verification QR', async () => {
    const source = await PDFDocument.create()
    source.addPage([841.89, 595.28])
    const bytes = await createScanTestPdf(
      await source.save(),
      `https://tasdiqapp.com/verify/${credentialId}`,
      credentialId,
      'CTF/HIMASTI/000001',
      layout,
    )

    const output = await PDFDocument.load(bytes)
    expect(output.getPageCount()).toBe(1)
    expect(output.getPages()[0].getSize()).toMatchObject({ width: 841.89, height: 595.28 })
  })

  it('refuses HTTP and non-verification destinations', async () => {
    const source = await PDFDocument.create()
    source.addPage([841.89, 595.28])
    const bytes = await source.save()

    await expect(createScanTestPdf(
      bytes,
      `http://tasdiqapp.com/verify/${credentialId}`,
      credentialId,
      'TEST-000001',
      layout,
    )).rejects.toThrow('public HTTPS')
    await expect(createScanTestPdf(
      bytes,
      `https://tasdiqapp.com/c/${credentialId}`,
      credentialId,
      'TEST-000001',
      layout,
    )).rejects.toThrow('public HTTPS')
  })
})
