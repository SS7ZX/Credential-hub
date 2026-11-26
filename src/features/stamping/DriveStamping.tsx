import { useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { GlobalWorkerOptions, getDocument, type PDFPageProxy, type PDFDocumentLoadingTask, type PageViewport } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { getPublicSiteUrl } from '../../config/brand'
import { supabase } from '../../lib/supabase'
import {
  QR_LABEL_GAP_POINTS,
  QR_SIZE_DEFAULT_POINTS,
  getLayoutIssue,
  pointPositionFromClick,
  type LayoutDraft,
  type PageDimensions,
} from './layout'
import { inspectPdfTemplate, MAX_STAMP_PDF_BYTES, PdfTemplateError, validatePdfFileType } from './pdf-template'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

type EventOption = { id: string; name: string }
type AchievementOption = { id: string; name: string; event_id: string | null }
type Props = {
  organizationId: string
  events: EventOption[]
  achievements: AchievementOption[]
}
type LayoutRow = {
  page_number: number
  x_points: number
  y_points: number
  size_points: number
  expected_page_width_points: number
  expected_page_height_points: number
  page_size_tolerance_points: number
}
type PreviewState = {
  width: number
  height: number
  viewport: PageViewport
}

const SAMPLE_CREDENTIAL_ID = '00000000-0000-4000-8000-000000000000'

function emptyDraft(): LayoutDraft {
  return {
    pageNumber: 1,
    x: 24,
    y: 30,
    size: QR_SIZE_DEFAULT_POINTS,
    pageWidth: 0,
    pageHeight: 0,
    tolerance: 1,
  }
}

export default function DriveStamping({ organizationId, events, achievements }: Props) {
  const [achievementId, setAchievementId] = useState('')
  const [draft, setDraft] = useState<LayoutDraft>(emptyDraft)
  const [layoutExists, setLayoutExists] = useState(false)
  const [sampleFile, setSampleFile] = useState<File | null>(null)
  const [pages, setPages] = useState<PageDimensions[]>([])
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [loadingLayout, setLoadingLayout] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewportRef = useRef<PageViewport | null>(null)

  const verifyUrl = `${getPublicSiteUrl()}/verify/${SAMPLE_CREDENTIAL_ID}`
  const selectedAchievement = achievements.find((item) => item.id === achievementId)
  const selectedEvent = events.find((item) => item.id === selectedAchievement?.event_id)
  const currentPage = pages[draft.pageNumber - 1]

  const numericDraft = useMemo(() => ({
    ...draft,
    pageNumber: Number(draft.pageNumber),
    x: Number(draft.x),
    y: Number(draft.y),
    size: Number(draft.size),
    pageWidth: Number(draft.pageWidth),
    pageHeight: Number(draft.pageHeight),
    tolerance: Number(draft.tolerance),
  }), [draft])
  const layoutIssue = currentPage
    ? getLayoutIssue(numericDraft, currentPage)
    : 'Choose a sample PDF and a valid page before saving.'
  const hasRotatedPage = pages.some((page) => page.rotation !== 0)

  useEffect(() => {
    let active = true
    void QRCode.toDataURL(verifyUrl, {
      errorCorrectionLevel: 'Q',
      margin: 4,
      width: 420,
      color: { dark: '#12231e', light: '#ffffff' },
    }).then((dataUrl) => {
      if (active) setQrDataUrl(dataUrl)
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Could not create the sample QR code.')
    })
    return () => { active = false }
  }, [verifyUrl])

  useEffect(() => {
    let active = true
    if (!achievementId || !supabase) return

    void (async () => {
      const { data, error: queryError } = await supabase.from('qr_layouts')
        .select('page_number, x_points, y_points, size_points, expected_page_width_points, expected_page_height_points, page_size_tolerance_points')
        .eq('organization_id', organizationId)
        .eq('achievement_id', achievementId)
        .maybeSingle()
        if (!active) return
        if (queryError) throw queryError
        if (data) {
          const row = data as LayoutRow
          setDraft({
            pageNumber: row.page_number,
            x: row.x_points,
            y: row.y_points,
            size: row.size_points,
            pageWidth: row.expected_page_width_points,
            pageHeight: row.expected_page_height_points,
            tolerance: row.page_size_tolerance_points,
          })
          setLayoutExists(true)
        }
    })()
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load this achievement layout.')
      })
      .finally(() => {
        if (active) setLoadingLayout(false)
      })

    return () => { active = false }
  }, [achievementId, organizationId])

  useEffect(() => {
    let active = true
    let task: PDFDocumentLoadingTask | null = null
    let page: PDFPageProxy | null = null
    const canvas = canvasRef.current
    if (!canvas || !sampleFile || !currentPage || currentPage.rotation !== 0) return

    void (async () => {
      const bytes = new Uint8Array(await sampleFile.arrayBuffer())
      task = getDocument({ data: bytes })
      const pdf = await task.promise
      page = await pdf.getPage(draft.pageNumber)
      const base = page.getViewport({ scale: 1 })
      const scale = Math.min(1, 760 / base.width, 900 / base.height)
      const viewport = page.getViewport({ scale })
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const context = canvas.getContext('2d')
      if (!context) throw new Error('This browser cannot render the selected PDF.')
      await Promise.resolve(page.render({ canvas, canvasContext: context, viewport }).promise)
      if (!active) return
      viewportRef.current = viewport
      setPreview({ width: viewport.width, height: viewport.height, viewport })
    })().catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Could not render the sample PDF.')
    })

    return () => {
      active = false
      page?.cleanup()
      if (task) void task.destroy()
    }
  }, [currentPage, draft.pageNumber, sampleFile])

  async function loadSample(file?: File) {
    if (!file) return
    setError('')
    setMessage('')
    try {
      validatePdfFileType(file.type)
      if (file.size > MAX_STAMP_PDF_BYTES) throw new PdfTemplateError('too_large', 'PDF files must be 15 MB or smaller.')
      const metrics = await inspectPdfTemplate(new Uint8Array(await file.arrayBuffer()))
      if (!metrics.length) throw new PdfTemplateError('pdf_invalid', 'The PDF has no pages.')
      if (metrics.some((page) => page.rotation !== 0)) {
        throw new PdfTemplateError('pdf_rotated', 'Rotated PDFs are not supported. Use an unrotated source file.')
      }
      setPages(metrics)
      setSampleFile(file)
      setDraft((current) => {
        const page = metrics[current.pageNumber - 1] ?? metrics[0]
        const pageNumber = metrics[current.pageNumber - 1] ? current.pageNumber : 1
        return {
          ...current,
          pageNumber,
          ...(!layoutExists ? { pageWidth: page.width, pageHeight: page.height } : {}),
        }
      })
    } catch (cause) {
      setSampleFile(null)
      setPages([])
      setPreview(null)
      setError(cause instanceof Error ? cause.message : 'Could not inspect the selected PDF.')
    }
  }

  function updateDraft<K extends keyof LayoutDraft>(key: K, value: LayoutDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function placeQr(event: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    const viewport = viewportRef.current
    if (!canvas || !viewport || !currentPage) return
    const rect = canvas.getBoundingClientRect()
    const viewportX = (event.clientX - rect.left) / rect.width * viewport.width
    const viewportY = (event.clientY - rect.top) / rect.height * viewport.height
    const position = pointPositionFromClick(
      viewportX,
      viewportY,
      currentPage.width,
      currentPage.height,
      numericDraft.size,
      (x, y): [number, number] => {
        const point = viewport.convertToPdfPoint(x, y)
        return [point[0], point[1]]
      },
    )
    updateDraft('x', Number(position.x.toFixed(3)))
    updateDraft('y', Number(position.y.toFixed(3)))
  }

  async function saveLayout() {
    if (!supabase || !achievementId || !currentPage || layoutIssue) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const { error: saveError } = await supabase.rpc('save_qr_layout', {
        p_organization_id: organizationId,
        p_achievement_id: achievementId,
        p_page_number: numericDraft.pageNumber,
        p_x_points: numericDraft.x,
        p_y_points: numericDraft.y,
        p_size_points: numericDraft.size,
        p_expected_page_width_points: numericDraft.pageWidth,
        p_expected_page_height_points: numericDraft.pageHeight,
        p_page_size_tolerance_points: numericDraft.tolerance,
      })
      if (saveError) throw saveError
      setLayoutExists(true)
      setMessage('QR layout saved for this achievement.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this QR layout.')
    } finally {
      setSaving(false)
    }
  }

  const boxPosition = preview && currentPage
    ? preview.viewport.convertToViewportPoint(numericDraft.x, numericDraft.y + numericDraft.size)
    : null
  const labelPosition = preview && currentPage
    ? preview.viewport.convertToViewportPoint(
      numericDraft.x + numericDraft.size + QR_LABEL_GAP_POINTS,
      numericDraft.y + numericDraft.size,
    )
    : null

  return (
    <section className="admin-card batch-card stamping-panel">
      <span className="eyebrow">EXISTING PDF STAMPING</span>
      <h2>Configure QR placement</h2>
      <p>Credentials must be issued first. This editor previews a local sample PDF in your browser; the sample is not uploaded or saved.</p>
      <label className="stamping-field">Achievement
        <select value={achievementId} onChange={(event) => {
          setAchievementId(event.target.value)
          setError('')
          setMessage('')
          setPages([])
          setPreview(null)
          setSampleFile(null)
          setLayoutExists(false)
          setDraft(emptyDraft())
          setLoadingLayout(Boolean(event.target.value))
        }} disabled={loadingLayout}>
          <option value="">Choose achievement</option>
          {achievements.map((achievement) => (
            <option value={achievement.id} key={achievement.id}>
              {events.find((item) => item.id === achievement.event_id)?.name ?? 'No event'} · {achievement.name}
            </option>
          ))}
        </select>
      </label>
      {selectedAchievement && (
        <div className="stamping-section-heading">
          <strong>{selectedEvent?.name ?? 'No event'} &gt; {selectedAchievement.name}</strong>
          <span>{layoutExists ? 'Layout saved' : 'Layout not saved'}</span>
        </div>
      )}
      {achievementId && (
        <>
          <label className="csv-upload stamping-sample-upload">Choose a local sample PDF
            <input type="file" accept="application/pdf" onChange={(event) => void loadSample(event.target.files?.[0])} />
          </label>
          {sampleFile && <p className="stamping-note">{sampleFile.name} · {(sampleFile.size / 1024 / 1024).toFixed(2)} MB · {pages.length} pages</p>}
          {hasRotatedPage && <p className="admin-error" role="alert">Rotated PDFs are rejected. Select an unrotated source file.</p>}
          {currentPage && (
            <div className="stamping-preview-area">
              <p className="stamping-note">Click the certificate where the QR should be centered. Coordinates are measured from the PDF page’s lower-left corner.</p>
              <div className="stamping-canvas-wrap" style={{ aspectRatio: `${currentPage.width} / ${currentPage.height}` }}>
                <canvas ref={canvasRef} onClick={placeQr} aria-label="PDF page preview; click to place the QR code" />
                {preview && boxPosition && qrDataUrl && (
                  <img
                    className="stamping-qr-overlay"
                    src={qrDataUrl}
                    alt="Sample QR with a white quiet zone"
                    style={{
                      left: `${boxPosition[0] / preview.width * 100}%`,
                      top: `${boxPosition[1] / preview.height * 100}%`,
                      width: `${numericDraft.size / preview.width * 100}%`,
                      height: `${numericDraft.size / preview.height * 100}%`,
                    }}
                  />
                )}
                {preview && labelPosition && (
                  <div
                    className="stamping-id-overlay"
                    style={{
                      left: `${labelPosition[0] / preview.width * 100}%`,
                      top: `${labelPosition[1] / preview.height * 100}%`,
                      width: `${132 / preview.width * 100}%`,
                    }}
                  >
                    <strong>ID {SAMPLE_CREDENTIAL_ID.slice(0, 8)}</strong>
                    <span>Serial SAMPLE-001</span>
                  </div>
                )}
              </div>
              <div className="stamping-page-nav">
                <label>Page
                  <select
                    value={draft.pageNumber}
                    onChange={(event) => {
                      const pageNumber = Number(event.target.value)
                      updateDraft('pageNumber', pageNumber)
                      const page = pages[pageNumber - 1]
                      if (page && !layoutExists) {
                        updateDraft('pageWidth', page.width)
                        updateDraft('pageHeight', page.height)
                      }
                    }}
                  >
                    {pages.map((_page, index) => <option value={index + 1} key={index}>{index + 1}</option>)}
                  </select>
                </label>
                <span>{currentPage.width.toFixed(2)} × {currentPage.height.toFixed(2)} pt · rotation {currentPage.rotation}°</span>
              </div>
            </div>
          )}
          <div className="stamping-fields">
            <label className="stamping-field">X (points)
              <input type="number" step="0.001" value={draft.x} onChange={(event) => updateDraft('x', event.target.valueAsNumber)} />
            </label>
            <label className="stamping-field">Y (points)
              <input type="number" step="0.001" value={draft.y} onChange={(event) => updateDraft('y', event.target.valueAsNumber)} />
            </label>
            <label className="stamping-field">QR size (points)
              <input type="number" step="0.001" min={25 * 72 / 25.4} max={30 * 72 / 25.4} value={draft.size} onChange={(event) => updateDraft('size', event.target.valueAsNumber)} />
              <small>25–30 mm; includes the white four-module quiet zone.</small>
            </label>
            <label className="stamping-field">Expected page width (points)
              <input type="number" step="0.001" value={draft.pageWidth} onChange={(event) => updateDraft('pageWidth', event.target.valueAsNumber)} />
            </label>
            <label className="stamping-field">Expected page height (points)
              <input type="number" step="0.001" value={draft.pageHeight} onChange={(event) => updateDraft('pageHeight', event.target.valueAsNumber)} />
            </label>
            <label className="stamping-field">Size tolerance (points)
              <input type="number" step="0.1" min="0" max="72" value={draft.tolerance} onChange={(event) => updateDraft('tolerance', event.target.valueAsNumber)} />
            </label>
          </div>
          <p className="stamping-note">QR error correction: Q · Sample URL: <code>{verifyUrl}</code></p>
          {layoutIssue && <p className="admin-error" role="alert">{layoutIssue}</p>}
          {error && <p className="admin-error" role="alert">{error}</p>}
          {message && <p className="admin-success" role="status">{message}</p>}
          <button className="button button-primary" disabled={saving || loadingLayout || Boolean(layoutIssue)} onClick={() => void saveLayout()}>
            {saving ? 'Saving layout…' : 'Save layout for achievement'}
          </button>
        </>
      )}
    </section>
  )
}
