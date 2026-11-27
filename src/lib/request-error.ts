import { copyId } from '../copy/id'

export function requestErrorMessage(error: unknown, fallback: string): string {
  const status = getStatus(error)
  if (status === 429) return copyId.errors.rateLimited
  if (status === 503) return copyId.errors.serviceUnavailable
  if (typeof window !== 'undefined' && !navigator.onLine) return copyId.errors.offline

  const code = getCode(error)
  if (code) {
    const knownCodes: Record<string, string> = {
      invalid_mime: copyId.errors.pdfWrongType,
      too_large: copyId.errors.pdfTooLarge,
      not_pdf: copyId.errors.pdfInvalid,
      pdf_signed: copyId.errors.pdfSigned,
      pdf_encrypted: copyId.errors.pdfEncrypted,
      pdf_invalid: copyId.errors.pdfInvalid,
      pdf_rotated: copyId.errors.pdfRotated,
      image_invalid: copyId.errors.imageInvalid,
      page_size_mismatch: copyId.errors.pageSizeMismatch,
      page_limit: copyId.errors.pageLimit,
      drive_forbidden: copyId.errors.driveForbidden,
      drive_rate_limited: copyId.errors.driveRateLimited,
      file_missing: copyId.errors.fileMissing,
      storage_upload_failed: copyId.errors.storageUploadFailed,
      stamping_service_unavailable: copyId.errors.stampingUnavailable,
    }
    if (knownCodes[code]) return knownCodes[code]
  }
  return fallback
}

function getStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined

  const candidate = error as {
    status?: unknown
    context?: unknown
  }

  if (typeof candidate.status === 'number') return candidate.status
  if (candidate.context instanceof Response) return candidate.context.status
  return undefined
}

function getCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}
