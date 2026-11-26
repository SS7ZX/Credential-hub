export const QR_SIZE_MIN_POINTS = 25 * 72 / 25.4
export const QR_SIZE_MAX_POINTS = 30 * 72 / 25.4
export const QR_SIZE_DEFAULT_POINTS = 28 * 72 / 25.4
export const QR_LABEL_GAP_POINTS = 4
export const QR_LABEL_WIDTH_POINTS = 132

export type PageDimensions = {
  width: number
  height: number
  rotation: number
}

export type LayoutDraft = {
  pageNumber: number
  x: number
  y: number
  size: number
  pageWidth: number
  pageHeight: number
  tolerance: number
}

export function getLayoutIssue(layout: LayoutDraft, page: PageDimensions): string | null {
  if (!Number.isInteger(layout.pageNumber) || layout.pageNumber < 1) return 'Choose a valid page number.'
  if (!Number.isFinite(layout.size) || layout.size < QR_SIZE_MIN_POINTS || layout.size > QR_SIZE_MAX_POINTS) {
    return 'QR size must be between 25 mm and 30 mm.'
  }
  if (![layout.x, layout.y, layout.pageWidth, layout.pageHeight, layout.tolerance].every(Number.isFinite)) {
    return 'Layout values must be valid numbers.'
  }
  if (page.rotation !== 0) return 'Rotated pages are not supported.'
  if (
    Math.abs(page.width - layout.pageWidth) > layout.tolerance
    || Math.abs(page.height - layout.pageHeight) > layout.tolerance
  ) return 'The PDF page size does not match the saved layout.'
  if (layout.x < 0 || layout.y < 0 || layout.x + layout.size > page.width || layout.y + layout.size > page.height) {
    return 'The QR quiet-zone box must fit entirely inside the page.'
  }
  if (layout.x + layout.size + QR_LABEL_GAP_POINTS + QR_LABEL_WIDTH_POINTS > page.width) {
    return 'There is not enough clear page width for the short ID and serial beside the QR.'
  }
  return null
}

export function pointPositionFromClick(
  offsetX: number,
  offsetY: number,
  viewportWidth: number,
  viewportHeight: number,
  boxSize: number,
  convertToPdfPoint: (x: number, y: number) => [number, number],
): { x: number; y: number } {
  const [centerX, centerY] = convertToPdfPoint(offsetX, offsetY)
  return {
    x: Math.max(0, Math.min(viewportWidth - boxSize, centerX - boxSize / 2)),
    y: Math.max(0, Math.min(viewportHeight - boxSize, centerY - boxSize / 2)),
  }
}

export function chooseRandomSample<T>(
  values: readonly T[],
  sampleSize: number,
  randomIndex: (exclusiveMax: number) => number = secureRandomIndex,
): T[] {
  const count = Math.min(Math.max(0, Math.floor(sampleSize)), values.length)
  const shuffled = [...values]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1)
    if (!Number.isInteger(swapIndex) || swapIndex < 0 || swapIndex > index) {
      throw new Error('Random source returned an invalid index.')
    }
    ;[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]]
  }
  return shuffled.slice(0, count)
}

function secureRandomIndex(exclusiveMax: number): number {
  if (!Number.isInteger(exclusiveMax) || exclusiveMax <= 0) {
    throw new Error('Random index range must be a positive integer.')
  }
  const range = 0x1_0000_0000
  const limit = range - range % exclusiveMax
  const values = new Uint32Array(1)
  let value = range
  while (value >= limit) {
    crypto.getRandomValues(values)
    value = values[0]
  }
  return value % exclusiveMax
}
