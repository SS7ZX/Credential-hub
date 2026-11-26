import { describe, expect, it } from 'vitest'
import {
  QR_SIZE_DEFAULT_POINTS,
  getLayoutIssue,
  pointPositionFromClick,
  chooseRandomSample,
} from './layout'

describe('QR stamping layout', () => {
  it('accepts a 28 mm quiet-zone box and an adjacent label on an A4 landscape page', () => {
    expect(getLayoutIssue({
      pageNumber: 1,
      x: 24,
      y: 30,
      size: QR_SIZE_DEFAULT_POINTS,
      pageWidth: 841.89,
      pageHeight: 595.28,
      tolerance: 1,
    }, { width: 841.89, height: 595.28, rotation: 0 })).toBeNull()
  })

  it('rejects a rotated page and a label that would extend past the page', () => {
    const layout = {
      pageNumber: 1,
      x: 700,
      y: 30,
      size: QR_SIZE_DEFAULT_POINTS,
      pageWidth: 841.89,
      pageHeight: 595.28,
      tolerance: 1,
    }
    expect(getLayoutIssue(layout, { width: 841.89, height: 595.28, rotation: 90 })).toMatch(/Rotated/)
    expect(getLayoutIssue(layout, { width: 841.89, height: 595.28, rotation: 0 })).toMatch(/serial/)
  })

  it('maps a canvas click to a clamped, centered PDF point box', () => {
    expect(pointPositionFromClick(
      900,
      100,
      600,
      800,
      80,
      (x, y) => [x * 0.5, 800 - y * 0.5],
    )).toEqual({ x: 410, y: 710 })
  })

  it('selects a distinct sample without mutating the source list', () => {
    const source = [1, 2, 3, 4]
    expect(chooseRandomSample(source, 2, (max) => max - 1)).toHaveLength(2)
    expect(new Set(chooseRandomSample(source, 4, (max) => max - 1)).size).toBe(4)
    expect(source).toEqual([1, 2, 3, 4])
  })
})
