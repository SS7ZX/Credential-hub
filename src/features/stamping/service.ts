import { supabase } from '../../lib/supabase'
import { MAX_STAMP_PDF_BYTES } from './pdf-template'

export class StampServiceError extends Error {
  readonly code: string
  readonly status: number
  readonly retryAfterSeconds: number | null

  constructor(
    code: string,
    status: number,
    retryAfterSeconds: number | null = null,
  ) {
    super(code)
    this.name = 'StampServiceError'
    this.code = code
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export async function callStampFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data, error } = await supabase.functions.invoke<T>(name, { body })
  if (error) throw await toStampServiceError(error)
  if (data === null) throw new Error('Stamping service returned no response.')
  return data
}

export async function callStampPreview(
  organizationId: string,
  rootFolderId: string,
  fileId: string,
): Promise<Uint8Array> {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data, error: sessionError } = await supabase.auth.getSession()
  if (sessionError) throw sessionError
  const token = data.session?.access_token
  if (!token) throw new Error('Your session expired. Sign in again.')
  const projectUrl = import.meta.env.VITE_SUPABASE_URL
  const apiKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!projectUrl || !apiKey) throw new Error('Supabase function configuration is incomplete.')

  const response = await fetch(`${projectUrl.replace(/\/+$/, '')}/functions/v1/preview-drive-file`, {
    method: 'POST',
    headers: {
      apikey: apiKey,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ organizationId, folderId: rootFolderId, fileId }),
    cache: 'no-store',
  })
  if (!response.ok) throw await readResponseError(response)
  if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/pdf') {
    throw new StampServiceError('invalid_pdf_response', 502)
  }
  const declaredLength = Number(response.headers.get('content-length') ?? 0)
  if (declaredLength > MAX_STAMP_PDF_BYTES) throw new StampServiceError('file_size_limit_exceeded', 413)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (!bytes.length || bytes.length > MAX_STAMP_PDF_BYTES) {
    throw new StampServiceError('file_size_limit_exceeded', 413)
  }
  return bytes
}

export async function retryStampFile(
  stampFileId: string,
  wait: (milliseconds: number) => Promise<void> = sleep,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await callStampFunction('stamp-one-file', { stampFileId })
      return
    } catch (error) {
      if (!(error instanceof StampServiceError) || !isRetryableDriveFailure(error) || attempt === 2) throw error
      const exponentialDelay = 1_000 * (2 ** attempt)
      const delay = Math.min(30_000, Math.max(exponentialDelay, error.retryAfterSeconds ? error.retryAfterSeconds * 1_000 : 0))
      await wait(delay)
    }
  }
}

function isRetryableDriveFailure(error: StampServiceError): boolean {
  return error.code === 'drive_forbidden' || error.code === 'drive_rate_limited'
}

async function toStampServiceError(error: { context?: unknown; message: string }): Promise<StampServiceError> {
  if (error.context instanceof Response) return readResponseError(error.context)
  return new StampServiceError(error.message || 'stamping_service_unavailable', 503)
}

async function readResponseError(response: Response): Promise<StampServiceError> {
  let code = 'stamping_service_unavailable'
  try {
    const body = await response.clone().json() as { error?: unknown }
    if (typeof body.error === 'string') code = body.error
  } catch {
    code = 'stamping_service_unavailable'
  }
  const retryAfterValue = Number(response.headers.get('retry-after'))
  const retryAfter = Number.isInteger(retryAfterValue) && retryAfterValue > 0 ? retryAfterValue : null
  return new StampServiceError(code, response.status, retryAfter)
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}
