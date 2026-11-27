import { describe, expect, it } from 'vitest'
import { requestErrorMessage } from './request-error'

describe('requestErrorMessage', () => {
  it('gives retry guidance for rate limits', () => {
    expect(requestErrorMessage({ context: new Response(null, { status: 429 }) }, 'Fallback'))
      .toBe('Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.')
  })

  it('gives retry guidance for service outages', () => {
    expect(requestErrorMessage({ status: 503, message: 'internal upstream detail' }, 'Fallback'))
      .toBe('Layanan sedang tidak tersedia. Coba lagi sebentar lagi.')
  })

  it('uses the fallback for non-error values', () => {
    expect(requestErrorMessage(null, 'Fallback')).toBe('Fallback')
  })

  it('does not expose raw provider messages', () => {
    expect(requestErrorMessage(new Error('database connection string leaked'), 'Safe fallback'))
      .toBe('Safe fallback')
  })

  it('maps known stamping failures to safe user guidance', () => {
    expect(requestErrorMessage({ code: 'pdf_signed' }, 'Safe fallback'))
      .toBe('PDF bertanda tangan digital tidak dapat diproses.')
  })
})
