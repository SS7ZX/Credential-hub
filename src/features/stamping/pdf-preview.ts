import { GlobalWorkerOptions, getDocument, type PDFDocumentLoadingTask } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export async function renderPdfThumbnail(bytes: Uint8Array, pageNumber = 1): Promise<string> {
  let task: PDFDocumentLoadingTask | null = null
  try {
    task = getDocument({ data: bytes })
    const document = await task.promise
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > document.numPages) {
      throw new Error('Configured preview page is outside the PDF page range.')
    }
    const page = await document.getPage(pageNumber)
    const baseViewport = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: Math.min(1, 420 / baseViewport.width, 240 / baseViewport.height) })
    const canvas = window.document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('This browser cannot render the selected PDF.')
    await Promise.resolve(page.render({ canvas, canvasContext: context, viewport }).promise)
    return canvas.toDataURL('image/png')
  } finally {
    if (task) await task.destroy()
  }
}
