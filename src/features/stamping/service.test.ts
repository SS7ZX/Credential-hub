import { describe, expect, it } from 'vitest'
import { retryStampFile, StampServiceError } from './service'

describe('retryStampFile', () => {
  it('backs off after Drive 403 and 429 failures', async () => {
    for (const code of ['drive_forbidden', 'drive_rate_limited']) {
      const delays: number[] = []
      let attempts = 0
      await expect(retryStampFile(
        'stamp-file-id',
        async (milliseconds) => { delays.push(milliseconds) },
        async () => {
          attempts += 1
          if (attempts < 3) throw new StampServiceError(code, code === 'drive_forbidden' ? 403 : 429, 5)
        },
      )).resolves.toBeUndefined()
      expect(attempts).toBe(3)
      expect(delays).toEqual([5000, 5000])
    }
  })

  it('stops after the bounded retry count and propagates the final Drive error', async () => {
    const delays: number[] = []
    let attempts = 0
    await expect(retryStampFile(
      'stamp-file-id',
      async (milliseconds) => { delays.push(milliseconds) },
      async () => {
        attempts += 1
        throw new StampServiceError('drive_rate_limited', 429)
      },
    )).rejects.toMatchObject({ code: 'drive_rate_limited', status: 429 })
    expect(attempts).toBe(3)
    expect(delays).toEqual([1000, 2000])
  })
})
