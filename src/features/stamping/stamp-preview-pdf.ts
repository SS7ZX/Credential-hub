import {
  PDFDocument,
  PDFName,
  StandardFonts,
  rgb,
} from 'pdf-lib'
import QRCode from 'qrcode'
import { getLayoutIssue, type LayoutDraft } from './layout'

const QUIET_ZONE_MODULES = 4
const LABEL_GAP_POINTS = 4
const LABEL_WIDTH_POINTS = 132
const LABEL_FONT_SIZE = 7
const LABEL_LINE_HEIGHT = 8

export async function createScanTestPdf(
  source: Uint8Array,
  verifyUrl: string,
  credentialId: string,
  serialNumber: string,
  layout: LayoutDraft,
): Promise<Uint8Array> {
  if (!/^https:\/\/[^/]+\/verify\/[0-9a-f-]{36}$/.test(verifyUrl)) {
    throw new Error('A public HTTPS credential verification URL is required for a scan test.')
  }

  const document = await PDFDocument.load(source, { ignoreEncryption: false, updateMetadata: false })
  const pages = document.getPages()
  const target = pages[layout.pageNumber - 1]
  if (!target) throw new Error('Choose a valid sample PDF page before creating a scan test.')

  const issue = getLayoutIssue(
    layout,
    { ...target.getSize(), rotation: target.getRotation().angle },
  )
  if (issue) throw new Error(issue)

  const qr = QRCode.create(verifyUrl, { errorCorrectionLevel: 'Q' })
  const moduleSize = layout.size / (qr.modules.size + QUIET_ZONE_MODULES * 2)
  const font = await document.embedFont(StandardFonts.Helvetica)
  const labels = wrapLabel(`Serial ${serialNumber}`, font, LABEL_FONT_SIZE, LABEL_WIDTH_POINTS)
  const allLabels = [`ID ${credentialId.slice(0, 8)}`, ...labels]
  if (allLabels.length * LABEL_LINE_HEIGHT > layout.size) {
    throw new Error('The credential serial is too long to fit beside the QR code.')
  }

  target.drawRectangle({
    x: layout.x,
    y: layout.y,
    width: layout.size,
    height: layout.size,
    color: rgb(1, 1, 1),
  })
  for (let row = 0; row < qr.modules.size; row += 1) {
    for (let column = 0; column < qr.modules.size; column += 1) {
      if (!qr.modules.data[row * qr.modules.size + column]) continue
      target.drawRectangle({
        x: layout.x + (QUIET_ZONE_MODULES + column) * moduleSize,
        y: layout.y + (QUIET_ZONE_MODULES + qr.modules.size - row - 1) * moduleSize,
        width: moduleSize,
        height: moduleSize,
        color: rgb(0, 0, 0),
      })
    }
  }

  const labelX = layout.x + layout.size + LABEL_GAP_POINTS
  const labelTop = layout.y + layout.size - LABEL_FONT_SIZE
  allLabels.forEach((text, index) => {
    target.drawText(text, {
      x: labelX,
      y: labelTop - index * LABEL_LINE_HEIGHT,
      size: LABEL_FONT_SIZE,
      font,
      color: rgb(0.08, 0.12, 0.1),
    })
  })

  document.setTitle('')
  document.setAuthor('')
  document.setSubject('')
  document.setKeywords([])
  document.setCreator('Credential Hub')
  document.setProducer('Credential Hub')
  const metadataEntry = document.catalog.get(PDFName.of('Metadata'))
  if (metadataEntry) {
    const metadataObject = document.context.lookup(metadataEntry)
    const metadataRef = metadataObject && document.context.getObjectRef(metadataObject)
    if (metadataRef) document.context.delete(metadataRef)
  }
  document.catalog.delete(PDFName.of('Metadata'))
  return document.save({ useObjectStreams: true })
}

function wrapLabel(
  value: string,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  fontSize: number,
  width: number,
): string[] {
  const words = value.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (font.widthOfTextAtSize(candidate, fontSize) <= width) {
      line = candidate
      continue
    }
    if (line) lines.push(line)
    line = ''
    for (const character of word) {
      const next = `${line}${character}`
      if (font.widthOfTextAtSize(next, fontSize) > width && line) {
        lines.push(line)
        line = character
      } else {
        line = next
      }
    }
  }
  if (line) lines.push(line)
  return lines
}
