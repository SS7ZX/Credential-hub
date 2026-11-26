import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { inspectPdfTemplate, PdfTemplateError } from './pdf-template'
import {
  matchStampFiles,
  parseStampCsv,
  type MatchedPair,
  type StampableCredential,
} from './matching'
import { renderPdfThumbnail } from './pdf-preview'
import { callStampFunction, callStampPreview, retryStampFile, StampServiceError } from './service'
import { chooseRandomSample } from './layout'

type EventOption = { id: string; name: string }
type AchievementOption = { id: string; name: string; event_id: string | null }
type Props = {
  organizationId: string
  events: EventOption[]
  achievements: AchievementOption[]
}
type DriveSection = {
  folderId: string
  folderName: string
  files: Array<{ id: string; name: string; mimeType: string; size?: string }>
}
type DriveListing = {
  folder: { id: string; name: string }
  sections: DriveSection[]
  fileCount: number
  maxPdfBytes: number
}
type RunRecord = {
  id: string
  achievement_id: string
  drive_folder_id: string
  status: string
  expected_file_count: number
  processed_count: number
  succeeded_count: number
  failed_count: number
  review_sample_file_ids: string[]
  created_at: string
}
type StoredStampFile = {
  id: string
  credential_id: string
  drive_file_id: string | null
  status: string
  error_code: string | null
}
type ReviewPair = MatchedPair & {
  stampFileId: string
  status: string
  errorCode: string | null
}
type ActiveRun = {
  id: string
  achievementId: string
  rootFolderId: string
  status: string
  expectedCount: number
  sample: ReviewPair[]
  pairs: ReviewPair[]
  fileRows: StoredStampFile[]
}
type PreviewStatus = { image?: string; error?: string; loading: boolean }
type LayoutPreview = {
  page_number: number
  expected_page_width_points: number
  expected_page_height_points: number
  page_size_tolerance_points: number
}
const MAX_CSV_BYTES = 2 * 1024 * 1024
const FILE_CONCURRENCY = 2
const SAMPLE_PER_ACHIEVEMENT = 10

function suggestAchievement(folderName: string, achievements: AchievementOption[]): string {
  const normalized = folderName.trim().toLocaleLowerCase()
  return achievements.find((item) => item.name.trim().toLocaleLowerCase() === normalized)?.id ?? ''
}

function randomIdempotencyKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function eventNameFor(achievementId: string, achievements: AchievementOption[], events: EventOption[]): string {
  const achievement = achievements.find((item) => item.id === achievementId)
  return events.find((item) => item.id === achievement?.event_id)?.name ?? 'No event'
}

export default function StampWorkflow({ organizationId, events, achievements }: Props) {
  const [folderId, setFolderId] = useState('')
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [csvRows, setCsvRows] = useState<ReturnType<typeof parseStampCsv>>([])
  const [listing, setListing] = useState<DriveListing | null>(null)
  const [folderAchievement, setFolderAchievement] = useState<Record<string, string>>({})
  const [credentials, setCredentials] = useState<StampableCredential[]>([])
  const [activeRuns, setActiveRuns] = useState<ActiveRun[]>([])
  const [history, setHistory] = useState<RunRecord[]>([])
  const [previewStatus, setPreviewStatus] = useState<Record<string, PreviewStatus>>({})
  const [loading, setLoading] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [reviewAcknowledged, setReviewAcknowledged] = useState(false)
  const [progress, setProgress] = useState({ finished: 0, total: 0 })
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const files = useMemo(() => listing?.sections.flatMap((section) =>
    section.files.map((file) => ({
      ...file,
      folderId: section.folderId,
      folderName: section.folderName,
    }))
  ) ?? [], [listing])

  const matching = useMemo(() => listing && csvRows.length
    ? matchStampFiles(csvRows, files, new Map(Object.entries(folderAchievement)), credentials)
    : null, [credentials, csvRows, files, folderAchievement, listing])

  const loadRunHistory = useCallback(async (): Promise<void> => {
    if (!supabase) throw new Error('Supabase is not configured.')
    const { data, error: queryError } = await supabase.from('stamp_runs')
      .select('id, achievement_id, drive_folder_id, status, expected_file_count, processed_count, succeeded_count, failed_count, review_sample_file_ids, created_at')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .limit(30)
    if (queryError) throw queryError
    setHistory((data ?? []) as RunRecord[])
  }, [organizationId])

  useEffect(() => {
    void loadRunHistory().catch((cause: unknown) => setError(messageOf(cause)))
  }, [loadRunHistory])

  useEffect(() => {
    let active = true
    const samples = activeRuns.flatMap((run) => run.status === 'review_required' ? run.sample : [])
    if (!samples.length || !listing) return

    void (async () => {
      if (!supabase) throw new Error('Supabase is not configured.')
      const achievementIds = [...new Set(samples.map((pair) => pair.achievementId))]
      const { data: layoutData, error: layoutError } = await supabase.from('qr_layouts')
        .select('achievement_id, page_number, expected_page_width_points, expected_page_height_points, page_size_tolerance_points')
        .eq('organization_id', organizationId)
        .in('achievement_id', achievementIds)
      if (layoutError) throw layoutError
      const layouts = new Map((layoutData ?? []).map((row) => [row.achievement_id, row as LayoutPreview & { achievement_id: string }]))
      for (const pair of samples) {
        if (!active) return
        setPreviewStatus((current) => ({ ...current, [pair.stampFileId]: { loading: true } }))
        try {
          const bytes = await callStampPreview(organizationId, listing.folder.id, pair.file.id)
          const pages = await inspectPdfTemplate(bytes)
          const layout = layouts.get(pair.achievementId)
          if (!layout) throw new PdfTemplateError('layout_missing', 'Save the QR layout before previewing this sample.')
          if (pages.some((page) => page.rotation !== 0)) throw new PdfTemplateError('pdf_rotated', 'Rotated PDF pages are rejected.')
          if (pages.some((page) =>
            Math.abs(page.width - layout.expected_page_width_points) > layout.page_size_tolerance_points
            || Math.abs(page.height - layout.expected_page_height_points) > layout.page_size_tolerance_points
          )) throw new PdfTemplateError('page_size_mismatch', 'A PDF page does not match the saved layout dimensions.')
          const image = await renderPdfThumbnail(bytes, layout.page_number)
          if (active) setPreviewStatus((current) => ({
            ...current,
            [pair.stampFileId]: { image, loading: false },
          }))
        } catch (cause) {
          if (active) setPreviewStatus((current) => ({
            ...current,
            [pair.stampFileId]: {
              loading: false,
              error: cause instanceof Error ? cause.message : 'PDF preview is unavailable.',
            },
          }))
        }
      }
    })().catch((cause: unknown) => {
      if (active) setError(messageOf(cause))
    })
    return () => { active = false }
  }, [activeRuns, listing, organizationId])

  const reviewPairs = activeRuns.flatMap((run) => run.sample)
  const allSamplePreviewsReady = reviewPairs.length > 0 && reviewPairs.every((pair) => {
    const status = previewStatus[pair.stampFileId]
    return Boolean(status?.image) && !status.error
  })
  const reviewPending = activeRuns.some((run) => run.status === 'review_required')

  async function loadDriveFolder() {
    if (!csvFile || !folderId.trim()) return
    setLoading(true)
    setError('')
    setMessage('')
    setListing(null)
    setCredentials([])
    setActiveRuns([])
    setPreviewStatus({})
    try {
      if (csvFile.size > MAX_CSV_BYTES) throw new Error('CSV files must be 2 MB or smaller.')
      const parsedRows = parseStampCsv(await csvFile.text())
      const result = await callStampFunction<DriveListing>('list-drive-folder', {
        organizationId,
        folderId: folderId.trim(),
      })
      const nextListing = {
        ...result,
        sections: result.sections.filter((section) => section.files.length > 0),
      }
      if (!nextListing.fileCount || !nextListing.sections.length) throw new Error('The selected Drive folder contains no files.')
      const nextMappings = Object.fromEntries(nextListing.sections.map((section) => [
        section.folderId,
        suggestAchievement(section.folderName, achievements),
      ]))
      const credentialResults = await Promise.all(achievements.map(async (achievement) => {
        if (!supabase) throw new Error('Supabase is not configured.')
        const { data, error: credentialError } = await supabase.rpc('list_stampable_credentials', {
          p_organization_id: organizationId,
          p_achievement_id: achievement.id,
        })
        if (credentialError) throw credentialError
        return ((data ?? []) as Omit<StampableCredential, 'achievement_id'>[]).map((item) => ({
          ...(item as Omit<StampableCredential, 'achievement_id'>),
          achievement_id: achievement.id,
        }))
      }))
      setCsvRows(parsedRows)
      setListing(nextListing)
      setFolderAchievement(nextMappings)
      setCredentials(credentialResults.flat())
      setMessage(`Loaded ${parsedRows.length} CSV rows and ${nextListing.fileCount} Drive files. Confirm every folder mapping below.`)
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setLoading(false)
    }
  }

  async function createReviewRuns() {
    if (!supabase || !listing || !matching) return
    setLoading(true)
    setError('')
    setMessage('')
    try {
      if (matching.issues.length || matching.pairs.length !== csvRows.length) {
        throw new Error('Resolve every CSV, Drive, recipient, and folder-mapping error before creating a run.')
      }
      const achievementIds = [...new Set(matching.pairs.map((pair) => pair.achievementId))]
      const { data: layoutRows, error: layoutError } = await supabase.from('qr_layouts')
        .select('achievement_id')
        .eq('organization_id', organizationId)
        .in('achievement_id', achievementIds)
      if (layoutError) throw layoutError
      const savedLayouts = new Set((layoutRows ?? []).map((row) => row.achievement_id))
      const missingLayouts = achievementIds.filter((id) => !savedLayouts.has(id))
      if (missingLayouts.length) {
        const names = missingLayouts.map((id) => achievements.find((item) => item.id === id)?.name ?? id)
        throw new Error(`Save a QR layout for each achievement before stamping: ${names.join(', ')}.`)
      }

      const groups = new Map<string, MatchedPair[]>()
      for (const pair of matching.pairs) {
        const group = groups.get(pair.achievementId) ?? []
        group.push(pair)
        groups.set(pair.achievementId, group)
      }

      const createdRuns: ActiveRun[] = []
      for (const [achievementId, pairs] of groups) {
        const { data: runId, error: runError } = await supabase.rpc('create_stamp_run', {
          p_organization_id: organizationId,
          p_achievement_id: achievementId,
          p_drive_folder_id: listing.folder.id,
          p_expected_file_count: pairs.length,
          p_idempotency_key: randomIdempotencyKey(),
        })
        if (runError || typeof runId !== 'string') throw runError ?? new Error('Stamp run creation returned no ID.')
        for (const pair of pairs) {
          const { error: registerError } = await supabase.rpc('register_stamp_file', {
            p_stamp_run_id: runId,
            p_credential_id: pair.credential.credential_id,
            p_drive_file_id: pair.file.id,
          })
          if (registerError) throw registerError
        }
        const { data: fileRows, error: filesError } = await supabase.from('stamp_files')
          .select('id, credential_id, drive_file_id, status, error_code')
          .eq('stamp_run_id', runId)
        if (filesError) throw filesError
        const storedFiles = fileRows as StoredStampFile[]
        const mappedPairs = pairs.map((pair) => {
          const stored = storedFiles.find((item) =>
            item.drive_file_id === pair.file.id && item.credential_id === pair.credential.credential_id
          )
          if (!stored) throw new Error('A registered Drive file could not be reloaded.')
          return {
            ...pair,
            stampFileId: stored.id,
            status: stored.status,
            errorCode: stored.error_code,
          }
        })
        createdRuns.push({
          id: runId,
          achievementId,
          rootFolderId: listing.folder.id,
          status: 'review_required',
          expectedCount: pairs.length,
          sample: chooseRandomSample(mappedPairs, SAMPLE_PER_ACHIEVEMENT),
          pairs: mappedPairs,
          fileRows: storedFiles,
        })
      }
      setActiveRuns(createdRuns)
      setPreviewStatus({})
      setReviewAcknowledged(false)
      setMessage('Review the random sample for every achievement and the complete matching list before approval.')
      await loadRunHistory()
    } catch (cause) {
      setError(messageOf(cause))
      await loadRunHistory().catch((refreshError: unknown) => setError(`${messageOf(cause)} Refresh failed: ${messageOf(refreshError)}`))
    } finally {
      setLoading(false)
    }
  }

  async function resumeRun(run: RunRecord) {
    if (!supabase) return
    setLoading(true)
    setError('')
    setMessage('')
    setActiveRuns([])
    setPreviewStatus({})
    try {
      const [drive, credentialResult, fileResult] = await Promise.all([
        callStampFunction<DriveListing>('list-drive-folder', {
          organizationId,
          folderId: run.drive_folder_id,
        }),
        supabase.rpc('list_stampable_credentials', {
          p_organization_id: organizationId,
          p_achievement_id: run.achievement_id,
        }),
        supabase.from('stamp_files')
          .select('id, credential_id, drive_file_id, status, error_code')
          .eq('stamp_run_id', run.id)
          .order('created_at'),
      ])
      if (credentialResult.error) throw credentialResult.error
      if (fileResult.error) throw fileResult.error
      const directory = (credentialResult.data ?? []) as Omit<StampableCredential, 'achievement_id'>[]
      const credentialsById = new Map(directory.map((credential) => [credential.credential_id, {
        ...credential,
        achievement_id: run.achievement_id,
      }]))
      const driveFiles = drive.sections.flatMap((section) => section.files.map((file) => ({
        ...file,
        folderId: section.folderId,
        folderName: section.folderName,
      })))
      const filesById = new Map(driveFiles.map((file) => [file.id, file]))
      const stored = (fileResult.data ?? []) as StoredStampFile[]
      const pairs: ReviewPair[] = stored.flatMap((item) => {
        if (!item.drive_file_id || item.status === 'deleted') return []
        const file = filesById.get(item.drive_file_id)
        const credential = credentialsById.get(item.credential_id)
        if (!file || !credential) return []
        return [{
          row: {
            full_name: credential.full_name ?? 'Anonymized recipient',
            email: credential.email ?? '',
            category: '',
            file_name: file.name,
          },
          file,
          credential,
          achievementId: run.achievement_id,
          stampFileId: item.id,
          status: item.status,
          errorCode: item.error_code,
        }]
      })
      const sample = run.review_sample_file_ids?.length
        ? run.review_sample_file_ids.flatMap((id) => pairs.filter((pair) => pair.stampFileId === id))
        : chooseRandomSample(pairs, SAMPLE_PER_ACHIEVEMENT)
      const active: ActiveRun = {
        id: run.id,
        achievementId: run.achievement_id,
        rootFolderId: run.drive_folder_id,
        status: run.status,
        expectedCount: run.expected_file_count,
        sample,
        pairs,
        fileRows: stored,
      }
      setActiveRuns([active])
      setListing({
        ...drive,
        sections: drive.sections.filter((section) => section.files.length > 0),
      })
      setPreviewStatus({})
      setReviewAcknowledged(false)
      if (pairs.length !== run.expected_file_count) {
        setError('This run is missing a source file or issued recipient mapping. Re-import the CSV and revalidate before approval.')
      } else {
        setMessage(`Resumed ${run.status.replaceAll('_', ' ')} run with ${pairs.length} mapped files.`)
      }
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setLoading(false)
    }
  }

  async function approveAndProcess() {
    if (!supabase || !activeRuns.length) return
    setProcessing(true)
    setError('')
    setMessage('')
    setProgress({ finished: 0, total: 0 })
    const approvalRuns = activeRuns.filter((run) => run.status === 'review_required')
    try {
      if (approvalRuns.length && (!reviewAcknowledged || !allSamplePreviewsReady)) {
        throw new Error('Preview every random sample and acknowledge the full list before processing.')
      }
      for (const run of approvalRuns) {
        const { error: approvalError } = await supabase.rpc('approve_stamp_run_review', {
          p_stamp_run_id: run.id,
          p_sampled_file_ids: run.sample.map((pair) => pair.stampFileId),
          p_acknowledged: true,
        })
        if (approvalError) throw approvalError
      }
      const approvalIds = new Set(approvalRuns.map((run) => run.id))
      setActiveRuns((current) => current.map((run) => approvalIds.has(run.id) ? { ...run, status: 'approved' } : run))

      const pendingFiles = activeRuns.flatMap((run) =>
        run.fileRows.filter((item) => item.status === 'pending' || item.status === 'failed')
      )
      setProgress({ finished: 0, total: pendingFiles.length })
      let nextIndex = 0
      let finishedCount = 0
      const failures: string[] = []
      const workers = Array.from({ length: Math.min(FILE_CONCURRENCY, pendingFiles.length) }, async () => {
        while (nextIndex < pendingFiles.length) {
          const file = pendingFiles[nextIndex]
          nextIndex += 1
          try {
            await retryStampFile(file.id)
          } catch (cause) {
            const code = cause instanceof StampServiceError ? cause.code : 'stamping_service_unavailable'
            failures.push(`${file.id}: ${code}`)
          } finally {
            finishedCount += 1
            setProgress({ finished: finishedCount, total: pendingFiles.length })
          }
        }
      })
      await Promise.all(workers)
      await loadRunHistory()
      if (failures.length) {
        setError(`${failures.length} file(s) failed after retry. Sanitized failures: ${failures.slice(0, 10).join('; ')}`)
      } else {
        setMessage(`Stamping finished for ${pendingFiles.length} file(s).`)
      }
      const refreshed = await refreshActiveRunStatuses(activeRuns)
      setActiveRuns(refreshed)
    } catch (cause) {
      setError(messageOf(cause))
      await loadRunHistory().catch((refreshError: unknown) => setError(`${messageOf(cause)} Refresh failed: ${messageOf(refreshError)}`))
    } finally {
      setProcessing(false)
    }
  }

  async function refreshActiveRunStatuses(runs: ActiveRun[]): Promise<ActiveRun[]> {
    const client = supabase
    if (!client) return runs
    return await Promise.all(runs.map(async (run) => {
      const [{ data: data, error: queryError }, { data: runData, error: runError }] = await Promise.all([
        client.from('stamp_files')
          .select('id, credential_id, drive_file_id, status, error_code')
          .eq('stamp_run_id', run.id),
        client.from('stamp_runs').select('status').eq('id', run.id).single(),
      ])
      if (queryError || runError) throw queryError ?? runError
      const files = (data ?? []) as StoredStampFile[]
      const byId = new Map(files.map((item) => [item.id, item]))
      return {
        ...run,
        status: runData.status,
        fileRows: files,
        pairs: run.pairs.map((pair) => {
          const updated = byId.get(pair.stampFileId)
          return updated ? { ...pair, status: updated.status, errorCode: updated.error_code } : pair
        }),
      }
    }))
  }

  return (
    <section className="admin-card batch-card stamping-panel">
      <span className="eyebrow">GOOGLE DRIVE IMPORT</span>
      <h2>Match, review, and stamp existing certificates</h2>
      <p>Read-only Drive access. The CSV and recipient names remain in this browser and are not saved to stamping records or audit logs.</p>
      <div className="stamping-fields stamping-import-fields">
        <label className="stamping-field">Top-level Drive folder ID
          <input value={folderId} onChange={(event) => setFolderId(event.target.value)} maxLength={255} autoComplete="off" />
          <small>Paste the ID only, not a Drive URL. The service account needs Viewer access.</small>
        </label>
        <label className="stamping-field">CSV file
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => {
              setCsvFile(event.target.files?.[0] ?? null)
              setListing(null)
              setCsvRows([])
              setError('')
            }}
          />
          <small>Required headers: full_name, email, category, file_name. Maximum 2 MB.</small>
        </label>
      </div>
      <button className="button button-secondary" disabled={loading || processing || !folderId.trim() || !csvFile} onClick={() => void loadDriveFolder()}>
        {loading ? 'Loading Drive and CSV…' : 'List Drive files and validate CSV'}
      </button>

      {listing && (
        <div className="stamping-mapping">
          <h3>Confirm each Drive folder → achievement mapping</h3>
          {listing.sections.map((section) => (
            <label className="stamping-field stamping-map-row" key={section.folderId}>
              <span>{section.folderName} · {section.files.length} file(s)</span>
              <select
                value={folderAchievement[section.folderId] ?? ''}
                onChange={(event) => setFolderAchievement((current) => ({ ...current, [section.folderId]: event.target.value }))}
              >
                <option value="">Choose achievement</option>
                {achievements.map((achievement) => (
                  <option value={achievement.id} key={achievement.id}>
                    {eventNameFor(achievement.id, achievements, events)} · {achievement.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {matching && (
            <>
              <p className={matching.issues.length ? 'admin-error' : 'admin-success'} role={matching.issues.length ? 'alert' : 'status'}>
                {matching.issues.length
                  ? `${matching.issues.length} hard error(s); no run can be created until all are resolved.`
                  : `Exact match passed: ${matching.pairs.length} CSV rows map to ${files.length} Drive files and issued credentials.`}
              </p>
              {matching.issues.length > 0 && (
                <ul className="stamping-issues">
                  {matching.issues.slice(0, 50).map((issue, index) => <li key={`${issue.code}-${index}`}><strong>{issue.code}</strong> {issue.detail}</li>)}
                  {matching.issues.length > 50 && <li>And {matching.issues.length - 50} more error(s).</li>}
                </ul>
              )}
              <button
                className="button button-primary"
                disabled={loading || processing || matching.issues.length > 0 || !matching.pairs.length}
                onClick={() => void createReviewRuns()}
              >
                Create review-only run(s)
              </button>
            </>
          )}
        </div>
      )}

      {activeRuns.length > 0 && (
        <div className="stamping-review">
          <h3>Mandatory match review</h3>
          <p>Review {SAMPLE_PER_ACHIEVEMENT} random name-vs-file pairs per achievement (or every pair when fewer than 10), then inspect the full list. No PDF is stamped before explicit approval.</p>
          {activeRuns.map((run) => (
            <section className="stamping-run-review" key={run.id}>
              <div className="stamping-section-heading">
                <strong>{eventNameFor(run.achievementId, achievements, events)} &gt; {achievements.find((item) => item.id === run.achievementId)?.name ?? run.achievementId}</strong>
                <span>{run.status.replaceAll('_', ' ')} · {run.fileRows.filter((item) => item.status === 'completed').length}/{run.expectedCount} completed</span>
              </div>
              {run.status === 'review_required' && (
                <div className="stamping-samples">
                  {run.sample.map((pair) => {
                    const preview = previewStatus[pair.stampFileId]
                    return (
                      <article className="stamping-sample-card" key={pair.stampFileId}>
                        <div className="stamping-sample-image">
                          {preview?.image
                            ? <img src={preview.image} alt={`Certificate preview for ${pair.row.file_name}`} />
                            : <span role={preview?.error ? 'alert' : 'status'}>{preview?.error ?? (preview?.loading ? 'Rendering preview…' : 'Waiting for preview…')}</span>}
                        </div>
                        <div className="stamping-sample-match">
                          <span className="eyebrow">RECIPIENT FROM CSV</span><strong>{pair.row.full_name}</strong>
                          <span className="eyebrow">EXACT DRIVE FILE</span><strong>{pair.file.name}</strong>
                          <small>{pair.credential.serial_number} · {pair.row.category || 'No category'}</small>
                        </div>
                      </article>
                    )
                  })}
                </div>
              )}
              <details className="stamping-full-review" open={run.status === 'review_required'}>
                <summary>Full file list ({run.pairs.length} of {run.expectedCount} mapped)</summary>
                <div className="stamping-file-list">
                  {run.pairs.map((pair) => (
                    <div className="stamping-file-row" key={pair.stampFileId}>
                      <span>{pair.row.full_name}</span>
                      <span>{pair.file.name}</span>
                      <span>{pair.credential.serial_number}</span>
                      <span className={`stamping-status stamping-status-${pair.status}`}>{pair.status}{pair.errorCode ? ` · ${pair.errorCode}` : ''}</span>
                    </div>
                  ))}
                </div>
              </details>
            </section>
          ))}
          {reviewPending && (
            <label className="stamping-acknowledge">
              <input type="checkbox" checked={reviewAcknowledged} onChange={(event) => setReviewAcknowledged(event.target.checked)} />
              I checked every random preview and reviewed the full name, file, and serial list for each achievement.
            </label>
          )}
          {processing && (
            <p className="stamping-note" role="status">Processing one PDF per Edge Function call with concurrency {FILE_CONCURRENCY}: {progress.finished}/{progress.total} completed.</p>
          )}
          {reviewPending && (
            <button
              className="button button-primary"
              disabled={processing || loading || (reviewPending && (
                !reviewAcknowledged
                || !allSamplePreviewsReady
                || activeRuns.some((run) => run.pairs.length !== run.expectedCount)
              ))}
              onClick={() => void approveAndProcess()}
            >
              {processing ? `Stamping ${progress.finished}/${progress.total}…` : 'Approve review and start stamping'}
            </button>
          )}
          {!reviewPending && activeRuns.some((run) => run.fileRows.some((item) => item.status === 'pending' || item.status === 'failed')) && (
            <button className="button button-primary" disabled={processing || loading} onClick={() => void approveAndProcess()}>
              {processing ? `Resuming ${progress.finished}/${progress.total}…` : 'Resume pending or failed files'}
            </button>
          )}
        </div>
      )}

      {history.length > 0 && (
        <section className="stamping-history">
          <h3>Recent stamping runs</h3>
          {history.map((run) => (
            <div className="stamping-history-row" key={run.id}>
              <div>
                <strong>{eventNameFor(run.achievement_id, achievements, events)} &gt; {achievements.find((item) => item.id === run.achievement_id)?.name ?? run.achievement_id}</strong>
                <small>{run.status.replaceAll('_', ' ')} · {run.processed_count}/{run.expected_file_count} processed · {run.succeeded_count} succeeded · {run.failed_count} failed · {new Date(run.created_at).toLocaleString()}</small>
              </div>
              {!['completed', 'cancelled'].includes(run.status) && (
                <button className="button button-secondary" disabled={loading || processing} onClick={() => void resumeRun(run)}>Open / resume</button>
              )}
            </div>
          ))}
        </section>
      )}

      {error && <p className="admin-error" role="alert">{error}</p>}
      {message && <p className="admin-success" role="status">{message}</p>}
      <button className="admin-reload" disabled={loading || processing} onClick={() => void loadRunHistory().catch((cause: unknown) => setError(messageOf(cause)))}>
        Refresh stamping runs
      </button>
    </section>
  )
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Stamping request failed. Please try again.'
}
