import { lazy, Suspense, useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import Papa from 'papaparse'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { requestErrorMessage } from './lib/request-error'
import { NetworkStatus } from './components/NetworkStatus'
import { copyId } from './copy/id'

const DriveStamping = lazy(() => import('./features/stamping/DriveStamping'))

type Organization = { id: string; name: string; slug: string }
type Membership = { role: 'owner' | 'admin' | 'issuer' | 'viewer'; organizations: Organization }
type EventRecord = {
  id: string
  name: string
  event_date: string | null
  location: string | null
  description: string | null
  serial_prefix: string | null
  status: string
}
type Achievement = {
  id: string
  name: string
  event_id: string | null
  category: string | null
  criteria_narrative: string | null
  serial_prefix: string | null
}
type Batch = {
  id: string
  event_id: string | null
  achievement_id: string
  created_at: string
  status: string
  total: number
  processed_count: number
  succeeded: number
  failed: number
  options: { sendEmail?: boolean }
}
type BatchOutcome = {
  rowNumber: number
  status: string
  errorCode: string | null
  serialNumber: string | null
}
type Credential = { id: string; serial_number: string; issued_at: string | null; status: string; visibility: string; achievement_id: string | null }
type OrganizationMember = { user_id: string; role: 'owner' | 'admin' | 'issuer' | 'viewer'; joined_at: string }
type Recipient = { id: string; full_name: string | null; email: string | null; anonymized_at: string | null }
type AuditEntry = { id: string; action: string; entity_type: string; entity_id: string | null; metadata: Record<string, unknown>; created_at: string }
type CsvRow = Record<string, string>

const csvColumns = ['full_name', 'email']

function messageOf(error: unknown): string {
  return requestErrorMessage(error, copyId.errors.requestFailed)
}

function AdminHeader() {
  return (
    <>
      <a className="skip-link" href="#admin-content">{copyId.navigation.skipToMain}</a>
      <header className="topbar">
        <Link className="brand" to="/"><span className="brand-mark" aria-hidden="true">t</span><span>credential hub</span></Link>
        <nav aria-label="Navigasi utama">
          <Link className="nav-link" to="/">Public credential portal <span aria-hidden="true">↗</span></Link>
        </nav>
      </header>
      <NetworkStatus />
    </>
  )
}

export default function Admin({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [organizationsLoaded, setOrganizationsLoaded] = useState(false)
  const [organization, setOrganization] = useState<Organization | null>(null)
  const [role, setRole] = useState<Membership['role'] | null>(null)
  const [events, setEvents] = useState<EventRecord[]>([])
  const [achievements, setAchievements] = useState<Achievement[]>([])
  const [batches, setBatches] = useState<Batch[]>([])
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [organizationMembers, setOrganizationMembers] = useState<OrganizationMember[]>([])
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([])
  const [rows, setRows] = useState<CsvRow[]>([])
  const [csvName, setCsvName] = useState('')
  const [organizationName, setOrganizationName] = useState('')
  const [organizationSlug, setOrganizationSlug] = useState('')
  const [eventName, setEventName] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [eventLocation, setEventLocation] = useState('')
  const [eventDescription, setEventDescription] = useState('')
  const [eventSerialPrefix, setEventSerialPrefix] = useState('')
  const [eventEditingId, setEventEditingId] = useState('')
  const [achievementName, setAchievementName] = useState('')
  const [achievementCategory, setAchievementCategory] = useState('')
  const [achievementSerialPrefix, setAchievementSerialPrefix] = useState('')
  const [achievementDescription, setAchievementDescription] = useState('')
  const [achievementCriteria, setAchievementCriteria] = useState('')
  const [achievementEventId, setAchievementEventId] = useState('')
  const [participantName, setParticipantName] = useState('')
  const [participantEmail, setParticipantEmail] = useState('')
  const [participantExternalId, setParticipantExternalId] = useState('')
  const [driveStampingOpen, setDriveStampingOpen] = useState(false)
  const [memberEmail, setMemberEmail] = useState('')
  const [memberRole, setMemberRole] = useState<'admin' | 'issuer' | 'viewer'>('viewer')
  const [selectedEvent, setSelectedEvent] = useState('')
  const [selectedAchievement, setSelectedAchievement] = useState('')
  const [resumeBatchId, setResumeBatchId] = useState('')
  const [pendingBatchKey, setPendingBatchKey] = useState('')
  const [batchDetailId, setBatchDetailId] = useState('')
  const [batchDetailPage, setBatchDetailPage] = useState(0)
  const [batchOutcomes, setBatchOutcomes] = useState<BatchOutcome[]>([])
  const [resendRequestKeys, setResendRequestKeys] = useState<Record<string, string>>({})
  const [pendingEmailIds, setPendingEmailIds] = useState<Record<string, boolean>>({})
  const [duplicatePolicy, setDuplicatePolicy] = useState<'skip' | 'reissue' | 'error'>('skip')
  const [visibility, setVisibility] = useState<'unlisted' | 'public'>('unlisted')
  const [sendEmail, setSendEmail] = useState(false)
  const [busy, setBusy] = useState(true)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [revokeId, setRevokeId] = useState('')
  const [revokeReason, setRevokeReason] = useState('')
  const [anonymizeId, setAnonymizeId] = useState('')

  const loadDashboard = useCallback(async (
    organizationId: string,
    membershipRole: Membership['role'],
  ) => {
    if (!supabase) return
    setError('')
    const [eventResult, achievementResult, batchResult, credentialResult, memberResult] = await Promise.all([
      supabase.from('events').select('id, name, event_date, location, description, serial_prefix, status').eq('organization_id', organizationId).order('created_at', { ascending: false }),
      supabase.from('achievements').select('id, name, event_id, category, criteria_narrative, serial_prefix').eq('organization_id', organizationId).order('created_at', { ascending: false }),
      supabase.from('issuance_batches').select('id, event_id, achievement_id, created_at, status, total, processed_count, succeeded, failed, options').eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(10),
      supabase.from('credentials').select('id, serial_number, issued_at, status, visibility, achievement_id').eq('organization_id', organizationId).order('issued_at', { ascending: false }).limit(20),
      supabase.from('organization_members').select('user_id, role, joined_at').eq('organization_id', organizationId).order('joined_at'),
    ])
    const firstError = eventResult.error ?? achievementResult.error ?? batchResult.error ?? credentialResult.error ?? memberResult.error
    if (firstError) throw firstError
    const canManagePrivacy = membershipRole === 'owner' || membershipRole === 'admin'
    const [recipientData, auditData] = await Promise.all([
      canManagePrivacy
        ? supabase.from('recipients')
          .select('id, full_name, email, anonymized_at')
          .eq('organization_id', organizationId)
          .order('created_at', { ascending: false })
          .limit(20)
          .then(({ data, error }) => {
            if (error) throw error
            return (data ?? []) as Recipient[]
          })
        : Promise.resolve([] as Recipient[]),
      canManagePrivacy
        ? supabase.from('audit_logs')
          .select('id, action, entity_type, entity_id, metadata, created_at')
          .eq('organization_id', organizationId)
          .order('created_at', { ascending: false })
          .limit(20)
          .then(({ data, error }) => {
            if (error) throw error
            return (data ?? []) as AuditEntry[]
          })
        : Promise.resolve([] as AuditEntry[]),
    ])
    setEvents((eventResult.data ?? []) as EventRecord[])
    setAchievements((achievementResult.data ?? []) as Achievement[])
    setBatches((batchResult.data ?? []) as Batch[])
    setCredentials((credentialResult.data ?? []) as Credential[])
    setOrganizationMembers((memberResult.data ?? []) as OrganizationMember[])
    setRecipients(recipientData)
    setAuditEntries(auditData)
  }, [])

  const loadOrganizations = useCallback(async () => {
    if (!supabase) throw new Error('Supabase is not configured.')
    const { data, error: queryError } = await supabase
      .from('organization_members')
      .select('role, organizations(id, name, slug)')
      .eq('user_id', session.user.id)
    if (queryError) throw queryError
    const validRows = ((data ?? []) as unknown as Membership[]).filter((item) => item.organizations)
    setMemberships(validRows)
    setOrganizationsLoaded(true)
    const selected = validRows[0]
    if (selected) {
      setOrganization(selected.organizations)
      setRole(selected.role)
      await loadDashboard(selected.organizations.id, selected.role)
    }
  }, [loadDashboard, session.user.id])

  useEffect(() => {
    void Promise.resolve()
      .then(() => loadOrganizations())
      .catch((cause: unknown) => setError(messageOf(cause)))
      .finally(() => setBusy(false))
  }, [loadOrganizations])

  if (!organizationsLoaded && !organization && !busy) {
    return (
      <div className="portal admin-portal">
        <AdminHeader />
        <main className="admin-content" id="admin-content">
          <div className="admin-heading"><span className="eyebrow">ISSUER WORKSPACE</span><h1>Workspace unavailable</h1></div>
          {error && <p className="admin-error" role="alert">{error}</p>}
          <button className="button button-secondary" disabled={busy} onClick={() => {
            setBusy(true)
            void loadOrganizations().catch((cause: unknown) => setError(messageOf(cause))).finally(() => setBusy(false))
          }}>Try again</button>
        </main>
      </div>
    )
  }

  if (organizationsLoaded && !memberships.length && !organization) {
    return (
      <div className="portal admin-portal">
        <AdminHeader />
        <main className="admin-content" id="admin-content">
          <div className="admin-heading"><span className="eyebrow">ISSUER WORKSPACE</span><h1>Create your organization</h1><p>This account does not belong to an issuer yet. Only the configured, verified owner email can create an organization. If you have been invited, sign in with that account.</p></div>
          <form className="admin-card admin-form" onSubmit={(event) => {
            event.preventDefault()
            void (async () => {
              if (!supabase) return
              setBusy(true)
              setError('')
              try {
                const name = organizationName.trim().replace(/\s+/g, ' ')
                const slug = organizationSlug.trim().toLowerCase()
                const { data, error: invokeError } = await supabase.functions.invoke<{ id: string }>('create-organization', {
                  body: { name, slug },
                })
                if (invokeError) throw invokeError
                if (!data || typeof data.id !== 'string') throw new Error('Organization provisioning returned an invalid result.')
                const created = { id: data.id, name, slug }
                setOrganization(created)
                setRole('owner')
                setMemberships([{ role: 'owner', organizations: created }])
                await loadDashboard(created.id, 'owner')
              } catch (cause) {
                setError(messageOf(cause))
              } finally {
                setBusy(false)
              }
            })()
          }}>
            <label>Organization name<input value={organizationName} onChange={(event) => {
              const name = event.target.value
              setOrganizationName(name)
              setOrganizationSlug(name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
            }} required maxLength={200} /></label>
            <label>Organization slug<input value={organizationSlug} onChange={(event) => setOrganizationSlug(event.target.value)} required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={100} /></label>
            {error && <p className="admin-error" role="alert">{error}</p>}
            <button className="button button-primary" disabled={busy || !organizationName.trim() || !organizationSlug.trim()}>{busy ? 'Creating…' : 'Create organization'}</button>
          </form>
          <button className="admin-signout" onClick={onSignOut}>Sign out</button>
        </main>
      </div>
    )
  }

  const selectedMember = memberships.find((item) => item.organizations.id === organization?.id)
  const selectedRole = selectedMember?.role ?? role
  const dashboardRole = selectedRole ?? 'viewer'
  const canIssue = selectedRole === 'owner' || selectedRole === 'admin' || selectedRole === 'issuer'
  const canRevoke = selectedRole === 'owner' || selectedRole === 'admin'
  const selectedAchievementRecord = achievements.find((item) => item.id === selectedAchievement)
  const activeSerialPrefix = selectedAchievementRecord?.serial_prefix ||
    events.find((item) => item.id === selectedEvent)?.serial_prefix

  function editEvent(item: EventRecord) {
    setEventEditingId(item.id)
    setEventName(item.name)
    setEventDate(item.event_date ?? '')
    setEventLocation(item.location ?? '')
    setEventDescription(item.description ?? '')
    setEventSerialPrefix(item.serial_prefix ?? '')
    setError('')
    setMessage('Event edits apply to future issuances; existing credential serials and signed content are unchanged.')
  }

  function cancelEventEdit() {
    setEventEditingId('')
    setEventName('')
    setEventDate('')
    setEventLocation('')
    setEventDescription('')
    setEventSerialPrefix('')
  }

  async function createEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !organization) return
    setBusy(true)
    setError('')
    try {
      const eventValues = {
        name: eventName.trim().replace(/\s+/g, ' '),
        event_date: eventDate || null,
        location: eventLocation.trim().replace(/\s+/g, ' ') || null,
        description: eventDescription.trim().replace(/\s+/g, ' ') || null,
        serial_prefix: eventSerialPrefix.trim() || null,
      }
      let eventId = eventEditingId
      if (eventEditingId) {
        const { error: updateError } = await supabase.rpc('update_event', {
          p_event_id: eventEditingId,
          p_name: eventValues.name,
          p_event_date: eventValues.event_date,
          p_location: eventValues.location,
          p_description: eventValues.description,
          p_serial_prefix: eventValues.serial_prefix,
        })
        if (updateError) throw updateError
      } else {
        const { data: createdEvent, error: insertError } = await supabase.from('events').insert({
          organization_id: organization.id,
          ...eventValues,
          status: 'active',
        }).select('id').single()
        if (insertError) throw insertError
        eventId = createdEvent.id
      }
      setEventEditingId('')
      setEventName('')
      setEventDate('')
      setEventLocation('')
      setEventDescription('')
      setEventSerialPrefix('')
      if (!eventEditingId) {
        setSelectedEvent(eventId)
        setAchievementEventId(eventId)
      }
      setMessage(eventEditingId ? 'Event updated. Existing credential serials are unchanged.' : 'Event created.')
      await loadDashboard(organization.id, dashboardRole)
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }

  async function createAchievement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !organization) return
    setBusy(true)
    setError('')
    try {
      const { error: insertError } = await supabase.from('achievements').insert({
        organization_id: organization.id,
        event_id: achievementEventId || null,
        name: achievementName.trim().replace(/\s+/g, ' '),
        category: achievementCategory.trim().replace(/\s+/g, ' ') || null,
        serial_prefix: achievementSerialPrefix.trim() || null,
        description: achievementDescription.trim(),
        criteria_narrative: achievementCriteria.trim(),
        status: 'active',
      })
      if (insertError) throw insertError
      setAchievementName('')
      setAchievementCategory('')
      setAchievementSerialPrefix('')
      setAchievementDescription('')
      setAchievementCriteria('')
      setMessage('Achievement created.')
      await loadDashboard(organization.id, dashboardRole)
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }

  function addParticipant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const full_name = participantName.trim().replace(/\s+/g, ' ')
    const email = participantEmail.trim().toLowerCase()
    const external_id = participantExternalId.trim().replace(/\s+/g, ' ')
    if (!full_name || !email) return
    setRows((current) => [...current, {
      full_name,
      email,
      ...(external_id ? { external_id } : {}),
    }])
    setCsvName('')
    setParticipantName('')
    setParticipantEmail('')
    setParticipantExternalId('')
    setError('')
    setMessage('Participant added to the review list.')
  }

  async function readCsv(file?: File) {
    if (!file) return
    setError('')
    setMessage('')
    setCsvName(file.name)
    Papa.parse<CsvRow>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      complete: (result) => {
        const headers = result.meta.fields ?? []
        const missing = csvColumns.filter((column) => !headers.includes(column))
        if (result.errors.length || missing.length || result.data.length === 0 || result.data.length > 1000) {
          setRows([])
          setError(
            missing.length
              ? `Missing required columns: ${missing.join(', ')}`
              : result.errors.length
                ? 'CSV could not be read. Check that the file uses a valid comma-separated format.'
                : result.data.length > 1000
                ? 'A batch can contain at most 1,000 recipients.'
                : 'The CSV has no recipient rows.',
          )
          return
        }
        setRows(result.data)
        setMessage(`${result.data.length} recipient rows loaded.`)
      },
      error: () => setError('CSV could not be read. Check that the file uses a valid comma-separated format.'),
    })
  }

  async function sendBatchEmails(batchId: string, requestKey: string) {
    if (!supabase || !organization) return { sent: 0, failed: 0, throttled: 0, pending: 0 }
    const { data: issued, error: issuedError } = await supabase
      .from('credentials')
      .select('id')
      .eq('organization_id', organization.id)
      .eq('batch_id', batchId)
      .eq('status', 'issued')
    if (issuedError) throw issuedError
    const totals = { sent: 0, failed: 0, throttled: 0, pending: 0 }
    for (let offset = 0; offset < (issued ?? []).length; offset += 50) {
      const { data: emailResult, error: emailError } = await supabase.functions.invoke<typeof totals>('send-emails', {
        body: {
          organizationId: organization.id,
          credentialIds: issued!.slice(offset, offset + 50).map((credential) => credential.id),
          requestKey,
        },
      })
      if (emailError) throw emailError
      totals.sent += emailResult?.sent ?? 0
      totals.failed += emailResult?.failed ?? 0
      totals.throttled += emailResult?.throttled ?? 0
      totals.pending += emailResult?.pending ?? 0
    }
    return totals
  }

  async function processBatch(batchId: string) {
    if (!supabase) return
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const { data, error: processError } = await supabase.functions.invoke<{
        complete: boolean
        processed_count: number
        total: number
        rows: Array<{ status: string }>
      }>('issue-batch', {
        body: { action: 'process', batchId, limit: 50 },
      })
      if (processError) throw processError
      if (!data) throw new Error('Issuance service returned no batch progress.')
      setMessage(`Processing ${data.processed_count} of ${data.total} recipients…`)
      if (data.complete) return
      if (!data.rows.length) throw new Error('Issuance batch made no progress. Resume it from batch history.')
    }
    throw new Error('Issuance batch was not completed within the processing limit. Resume it from batch history.')
  }

  async function issueCsv() {
    if (!supabase || !organization || !selectedEvent || !selectedAchievement || !rows.length) return
    setBusy(true)
    setError('')
    setMessage(resumeBatchId ? 'Staging participants into the draft batch…' : 'Creating issuance batch…')
    try {
      const shouldSendEmail = resumeBatchId
        ? batches.find((batch) => batch.id === resumeBatchId)?.options?.sendEmail ?? false
        : sendEmail
      let batchId = resumeBatchId
      if (!batchId) {
        const requestKey = pendingBatchKey || crypto.randomUUID()
        setPendingBatchKey(requestKey)
        const { data: created, error: createError } = await supabase.functions.invoke<{ id: string }>('issue-batch', {
          body: {
            action: 'create',
            organizationId: organization.id,
            eventId: selectedEvent,
            achievementId: selectedAchievement,
            rowsTotal: rows.length,
            idempotencyKey: requestKey,
            options: { duplicatePolicy, visibility, sendEmail },
          },
        })
        if (createError) throw createError
        if (!created?.id) throw new Error('Issuance service did not return a batch ID.')
        batchId = created.id
        setResumeBatchId(batchId)
      }

      for (let offset = 0; offset < rows.length; offset += 50) {
        const chunk = rows.slice(offset, offset + 50).map((payload, index) => ({
          rowNumber: offset + index + 1,
          payload,
        }))
        const { error: stageError } = await supabase.functions.invoke('issue-batch', {
          body: { action: 'stage', batchId, rows: chunk },
        })
        if (stageError) throw stageError
        setMessage(`Saving ${Math.min(offset + chunk.length, rows.length)} of ${rows.length} participant rows…`)
      }

      const { error: finalizeError } = await supabase.functions.invoke('issue-batch', {
        body: { action: 'finalize', batchId },
      })
      if (finalizeError) throw finalizeError
      setResumeBatchId('')
      setPendingBatchKey('')
      setRows([])
      setCsvName('')
      await processBatch(batchId)
      const totals = shouldSendEmail
        ? await sendBatchEmails(batchId, batchId)
        : { sent: 0, failed: 0, throttled: 0, pending: 0 }
      setMessage(shouldSendEmail
        ? `Batch completed. Emails sent: ${totals.sent}; failed: ${totals.failed}; throttled: ${totals.throttled}; pending confirmation: ${totals.pending}.`
        : 'Issuance batch processed. Failed rows can be retried from the batch list.')
      await loadDashboard(organization.id, dashboardRole)
    } catch (cause) {
      const primaryError = messageOf(cause)
      if (organization) {
        try {
          await loadDashboard(organization.id, dashboardRole)
        } catch (refreshError) {
          setError(`${primaryError} Dashboard refresh also failed: ${messageOf(refreshError)}`)
          return
        }
      }
      setError(primaryError)
    } finally {
      setBusy(false)
    }
  }

  async function continueBatch(batch: Batch) {
    if (!supabase || !organization) return
    setBusy(true)
    setError('')
    try {
      await processBatch(batch.id)
      if (batch.options?.sendEmail) {
        const totals = await sendBatchEmails(batch.id, batch.id)
        setMessage(`Batch resumed. Emails sent: ${totals.sent}; failed: ${totals.failed}; throttled: ${totals.throttled}; pending confirmation: ${totals.pending}.`)
      } else {
        setMessage('Issuance batch resumed.')
      }
      await loadDashboard(organization.id, dashboardRole)
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }

  async function retryBatch(batchId: string) {
    if (!supabase || !organization) return
    setBusy(true)
    setError('')
    try {
      const { error: retryError } = await supabase.functions.invoke('issue-batch', {
        body: { action: 'retry-failed', batchId, limit: 50 },
      })
      if (retryError) throw retryError
      setMessage('Retry request completed. Remaining failures can be retried again from this batch.')
      await loadDashboard(organization.id, dashboardRole)
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }

  async function resendCredentialEmail(credentialId: string, startNewAttempt = false) {
    if (!supabase || !organization) return
    setBusy(true)
    setError('')
    try {
      const requestKey = startNewAttempt
        ? crypto.randomUUID()
        : resendRequestKeys[credentialId] ?? crypto.randomUUID()
      setResendRequestKeys((current) => ({ ...current, [credentialId]: requestKey }))
      const { data, error: invokeError } = await supabase.functions.invoke<{
        sent: number
        failed: number
        throttled: number
        pending: number
      }>('send-emails', {
        body: {
          organizationId: organization.id,
          credentialIds: [credentialId],
          requestKey,
        },
      })
      if (invokeError) throw invokeError
      if (data?.pending) {
        setPendingEmailIds((current) => ({ ...current, [credentialId]: true }))
      } else {
        setResendRequestKeys((current) => {
          const next = { ...current }
          delete next[credentialId]
          return next
        })
        setPendingEmailIds((current) => {
          const next = { ...current }
          delete next[credentialId]
          return next
        })
      }
      setMessage(data?.sent
        ? 'Credential email sent.'
        : data?.throttled
          ? 'Email not sent because the daily sending limit was reached.'
          : data?.pending
            ? 'The earlier send outcome is uncertain; no duplicate was sent. A new attempt may deliver a duplicate.'
            : 'Email could not be sent. Use Resend to start a new attempt.')
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }

  async function loadBatchOutcomes(batchId: string, page: number) {
    if (!supabase) return
    const { data, error: invokeError } = await supabase.functions.invoke<{
      rows: BatchOutcome[]
    }>('issue-batch', {
      body: { action: 'list-rows', batchId, offset: page * 50, limit: 50 },
    })
    if (invokeError) throw invokeError
    setBatchOutcomes(data?.rows ?? [])
    setBatchDetailId(batchId)
    setBatchDetailPage(page)
  }

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !organization || selectedRole !== 'owner') return
    setBusy(true)
    setError('')
    try {
      const { data, error: invokeError } = await supabase.functions.invoke<{
        sent: number
        failed: number
        throttled: number
      }>('send-emails', {
        body: {
          action: 'invite-member',
          organizationId: organization.id,
          email: memberEmail.trim().toLowerCase(),
          role: memberRole,
        },
      })
      if (invokeError) throw invokeError
      if (!data || data.sent + data.failed + data.throttled !== 1) {
        throw new Error('Invitation service returned an invalid response.')
      }
      if (data.throttled) {
        setMessage('Invitation not sent because the organization daily email limit was reached.')
        return
      }
      if (data.failed) throw new Error('Invitation email could not be sent. Please try again.')
      setMemberEmail('')
      setMessage('Invitation email sent. In sandbox mode it is routed to the configured test recipient.')
      await loadDashboard(organization.id, dashboardRole)
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }

  async function updateMemberRole(userId: string, nextRole: OrganizationMember['role']) {
    if (!supabase || !organization || selectedRole !== 'owner' || userId === session.user.id) return
    setBusy(true)
    setError('')
    try {
      const { error: updateError } = await supabase.from('organization_members')
        .update({ role: nextRole })
        .eq('organization_id', organization.id)
        .eq('user_id', userId)
      if (updateError) throw updateError
      setMessage('Member role updated.')
      await loadDashboard(organization.id, dashboardRole)
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }

  async function removeMember(userId: string) {
    if (!supabase || !organization || selectedRole !== 'owner' || userId === session.user.id) return
    setBusy(true)
    setError('')
    try {
      const { error: deleteError } = await supabase.from('organization_members')
        .delete()
        .eq('organization_id', organization.id)
        .eq('user_id', userId)
      if (deleteError) throw deleteError
      setMessage('Organization member removed.')
      await loadDashboard(organization.id, dashboardRole)
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }

  async function downloadPdf(credential: Credential) {
    if (!supabase || !organization) return
    setBusy(true)
    setError('')
    try {
      const { data, error: sessionError } = await supabase.auth.getSession()
      if (sessionError) throw sessionError
      if (!data.session?.access_token) throw new Error('Your session expired. Sign in again.')
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-pdf`, {
        method: 'POST',
        headers: {
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          authorization: `Bearer ${data.session.access_token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ credentialId: credential.id }),
      })
      if (!response.ok) {
        setError(requestErrorMessage({ status: response.status }, copyId.errors.requestFailed))
        return
      }
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = `credential-${credential.serial_number}.pdf`
      link.click()
      URL.revokeObjectURL(url)
      setMessage(`PDF for ${credential.serial_number} downloaded.`)
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }

  async function revokeCredential(credentialId: string) {
    if (!supabase || !organization || !revokeReason.trim()) return
    setBusy(true)
    setError('')
    try {
      const { error: revokeError } = await supabase.rpc('revoke_credential', {
        p_credential_id: credentialId,
        p_reason: revokeReason.trim(),
      })
      if (revokeError) throw revokeError
      setRevokeId('')
      setRevokeReason('')
      setMessage('Credential revoked and audit record saved.')
      await loadDashboard(organization.id, dashboardRole)
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }

  async function updateVisibility(credentialId: string, nextVisibility: Credential['visibility']) {
    if (!supabase || !canRevoke || !organization) return
    setBusy(true)
    setError('')
    try {
      const { error: rpcError } = await supabase.rpc('set_credential_visibility', {
        p_credential_id: credentialId,
        p_visibility: nextVisibility,
      })
      if (rpcError) throw rpcError
      setMessage(`Credential visibility set to ${nextVisibility}.`)
      await loadDashboard(organization.id, dashboardRole)
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }

  async function anonymizeRecipient(recipientId: string) {
    if (!supabase || !organization || !canRevoke) return
    setBusy(true)
    setError('')
    try {
      const { error: functionError } = await supabase.functions.invoke('anonymize-recipient', {
        body: { recipientId },
      })
      if (functionError) throw functionError
      setAnonymizeId('')
      setMessage('Recipient data removed, credentials revoked, and stored stamped PDFs deleted.')
      await loadDashboard(organization.id, dashboardRole)
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="portal admin-portal">
      <AdminHeader />
      <main className="admin-content" id="admin-content">
        <div className="admin-heading">
          <span className="eyebrow">ISSUER WORKSPACE</span>
          <div className="admin-title-row"><div><h1>Credential dashboard</h1><p>Manage events, achievements, and credential issuance.</p></div><button className="admin-signout" onClick={onSignOut}>Sign out</button></div>
        </div>
        {busy && <p className="admin-loading" role="status" aria-live="polite">{copyId.common.loading}…</p>}
        {memberships.length > 1 && (
          <label className="org-switcher">Organization
            <select value={organization?.id ?? ''} onChange={(event) => {
              const member = memberships.find((item) => item.organizations.id === event.target.value)
              if (member) {
                setOrganization(member.organizations)
                setRole(member.role)
                void loadDashboard(member.organizations.id, member.role).catch((cause: unknown) => setError(messageOf(cause)))
              }
            }}>
              {memberships.map((member) => <option key={member.organizations.id} value={member.organizations.id}>{member.organizations.name}</option>)}
            </select>
          </label>
        )}
        {organization && <div className="org-banner"><span>{organization.name}</span><small>{selectedRole} · {organization.slug}</small></div>}
        {error && <p className="admin-error" role="alert">{error}</p>}
        {message && <p className="admin-success" role="status">{message}</p>}

        <div className="admin-stats">
          <article><span>Events</span><strong>{events.length}</strong></article>
          <article><span>Achievements</span><strong>{achievements.length}</strong></article>
          <article><span>Recent batches</span><strong>{batches.length}</strong></article>
          <article><span>Recent credentials</span><strong>{credentials.length}</strong></article>
        </div>

        {canIssue && (
          <div className="admin-grid">
            <form className="admin-card admin-form" onSubmit={(event) => void createEvent(event)}>
              <span className="eyebrow">EVENTS</span><h2>{eventEditingId ? 'Edit event' : 'Create event'}</h2>
              <label>Event name<input value={eventName} onChange={(event) => setEventName(event.target.value)} required maxLength={200} /></label>
              <label>Event date<input type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} /></label>
              <label>Location<input value={eventLocation} onChange={(event) => setEventLocation(event.target.value)} maxLength={200} /></label>
              <label>Description<textarea value={eventDescription} onChange={(event) => setEventDescription(event.target.value)} maxLength={2000} rows={2} /></label>
              <label>Credential serial prefix (optional)<input value={eventSerialPrefix} onChange={(event) => setEventSerialPrefix(event.target.value.toUpperCase())} placeholder="CTF/HIMASTI/001" pattern="[A-Z0-9][A-Z0-9._-]*(/[A-Z0-9][A-Z0-9._-]*){0,3}" maxLength={80} title="Use 1–4 slash-separated codes with letters, numbers, dot, underscore, or hyphen." /></label>
              <p className="stamping-note">Issued serials will look like <code>CTF/HIMASTI/001/000123</code>. The final number is allocated atomically from the organization-wide sequence; it is not a participant ID. Prefixes must be unique across events and achievements. Changing a prefix affects future credentials only.</p>
              <div className="credential-actions">
                <button className="button button-primary" disabled={busy || !eventName.trim()}>{busy ? 'Saving…' : eventEditingId ? 'Save event' : 'Add event'}</button>
                {eventEditingId && <button className="button button-quiet" type="button" disabled={busy} onClick={cancelEventEdit}>Cancel edit</button>}
              </div>
              <ul className="admin-list">{events.length ? events.slice(0, 10).map((item) => <li key={item.id}><span>{item.name}</span><small>{[item.event_date, item.location, item.serial_prefix].filter(Boolean).join(' · ') || item.status}</small>{canIssue && <button className="button button-quiet" type="button" disabled={busy} onClick={() => editEvent(item)}>Edit</button>}</li>) : <li><span>No events yet.</span></li>}</ul>
            </form>

            <form className="admin-card admin-form" onSubmit={(event) => void createAchievement(event)}>
              <span className="eyebrow">CERTIFICATE CATEGORIES</span><h2>Create achievement</h2>
              <label>Achievement name<input value={achievementName} onChange={(event) => setAchievementName(event.target.value)} required maxLength={200} /></label>
              <label>Category<input value={achievementCategory} onChange={(event) => setAchievementCategory(event.target.value)} placeholder="Participant, Speaker, Winner" maxLength={100} /></label>
              <label>Achievement serial prefix (optional)<input value={achievementSerialPrefix} onChange={(event) => setAchievementSerialPrefix(event.target.value.toUpperCase())} placeholder="CTF/HIMASTI/WINNER" pattern="[A-Z0-9][A-Z0-9._-]*(/[A-Z0-9][A-Z0-9._-]*){0,3}" maxLength={80} title="Use 1–4 slash-separated codes with letters, numbers, dot, underscore, or hyphen." /></label>
              <p className="stamping-note">An achievement prefix overrides its event prefix for new credentials. If blank, the event prefix applies. Prefixes are unique across events and achievements.</p>
              <label>Event<select value={achievementEventId} onChange={(event) => setAchievementEventId(event.target.value)}><option value="">Not linked to an event</option>{events.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
              <label>Description<textarea value={achievementDescription} onChange={(event) => setAchievementDescription(event.target.value)} required maxLength={2000} rows={2} /></label>
              <label>Criteria narrative<textarea value={achievementCriteria} onChange={(event) => setAchievementCriteria(event.target.value)} required maxLength={4000} rows={2} /></label>
              <button className="button button-primary" disabled={busy || !achievementName.trim() || !achievementDescription.trim() || !achievementCriteria.trim()}>{busy ? 'Saving…' : 'Add achievement'}</button>
              <ul className="admin-list">{achievements.length ? achievements.slice(0, 5).map((item) => <li key={item.id}><span>{item.category ? `${item.category} · ` : ''}{item.name}</span><small>{[item.criteria_narrative ? 'Ready to issue' : 'Add criteria before issue', item.serial_prefix ? `Prefix ${item.serial_prefix}` : null].filter(Boolean).join(' · ')}</small></li>) : <li><span>No achievements yet.</span></li>}</ul>
            </form>
          </div>
        )}

        {selectedRole === 'owner' && (
          <section className="admin-card batch-card">
            <span className="eyebrow">ORGANIZATION ACCESS</span><h2>Manage members</h2>
            <p>Invite a new or existing account by verified email. Invitations expire after seven days; sending is subject to the organization daily email limit.</p>
            <form className="member-add-form" onSubmit={(event) => void addMember(event)}>
              <label>Invite email<input type="email" value={memberEmail} onChange={(event) => setMemberEmail(event.target.value)} required /></label>
              <label>Role<select value={memberRole} onChange={(event) => setMemberRole(event.target.value as typeof memberRole)}><option value="viewer">Viewer</option><option value="issuer">Issuer</option><option value="admin">Admin</option></select></label>
              <button className="button button-primary" disabled={busy || !memberEmail.trim()}>Send invitation</button>
            </form>
            {organizationMembers.map((member) => (
              <div className="batch-row" key={member.user_id}>
                <div><strong>{member.user_id === session.user.id ? 'You' : `${member.user_id.slice(0, 8)}…`}</strong><small>Joined {new Date(member.joined_at).toLocaleDateString()}</small></div>
                <div className="credential-actions">
                  {member.user_id === session.user.id
                    ? <span className="member-role">{member.role} · signed in</span>
                    : member.role === 'owner'
                      ? <span className="member-role">Owner</span>
                      : <>
                        <select className="member-role-select" aria-label={`Role for ${member.user_id}`} value={member.role} disabled={busy} onChange={(event) => void updateMemberRole(member.user_id, event.target.value as OrganizationMember['role'])}>
                          <option value="viewer">Viewer</option><option value="issuer">Issuer</option><option value="admin">Admin</option>
                        </select>
                        <button className="button button-quiet" disabled={busy} onClick={() => void removeMember(member.user_id)}>Remove</button>
                      </>}
                </div>
              </div>
            ))}
          </section>
        )}

        {canIssue && (
          <section className="admin-card issuance-card">
            <span className="eyebrow">PARTICIPANTS & CREDENTIALS</span><h2>Prepare an event participant list</h2>
            <p>Select the event and certificate category, then add participants one at a time or import a CSV. Participant IDs are optional, private account data; they are not included in the signed credential and are removed if the recipient is anonymized.</p>
            <div className="issuance-controls">
              <label>Event<select value={selectedEvent} onChange={(event) => {
                setSelectedEvent(event.target.value)
                setSelectedAchievement('')
              }} required><option value="">Choose event</option>{events.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
              <label>Category / achievement<select value={selectedAchievement} onChange={(event) => setSelectedAchievement(event.target.value)} required disabled={!selectedEvent}><option value="">Choose category</option>{achievements.filter((item) => item.event_id === selectedEvent).map((item) => <option value={item.id} key={item.id}>{item.category ? `${item.category} · ` : ''}{item.name}</option>)}</select></label>
              <label>Duplicate policy<select value={duplicatePolicy} onChange={(event) => setDuplicatePolicy(event.target.value as typeof duplicatePolicy)}><option value="skip">Skip duplicates (default)</option><option value="reissue">Reissue</option><option value="error">Mark as error</option></select></label>
              <label>Visibility<select value={visibility} onChange={(event) => setVisibility(event.target.value as typeof visibility)}><option value="unlisted">Unlisted (default)</option><option value="public">Public</option></select></label>
            </div>
            {activeSerialPrefix && (
              <p className="stamping-note">Serial format for this achievement: <code>{activeSerialPrefix}/000123</code>. Achievement prefix takes precedence over the event prefix. The numeric suffix is globally allocated within this organization and does not contain participant data.</p>
            )}
            <label className="email-option"><input type="checkbox" checked={sendEmail} onChange={(event) => setSendEmail(event.target.checked)} /> Send credential emails after successful issuance (daily plan limit applies)</label>
            <form className="participant-entry-form" onSubmit={addParticipant}>
              <label>Participant name<input value={participantName} onChange={(event) => setParticipantName(event.target.value)} required maxLength={200} /></label>
              <label>Participant ID (optional)<input value={participantExternalId} onChange={(event) => setParticipantExternalId(event.target.value)} maxLength={120} /></label>
              <label>Email<input type="email" value={participantEmail} onChange={(event) => setParticipantEmail(event.target.value)} required maxLength={320} /></label>
              <button className="button button-secondary" disabled={!participantName.trim() || !participantEmail.trim()}>Add participant</button>
            </form>
            <p className="stamping-note">For a CSV, required columns: <code>full_name,email</code>. Optional: <code>external_id,issued_on,expires_on</code>. Add one row per participant in the selected category; a category/achievement is issued as its own batch. Rows are processed in server-side chunks of 50.</p>
            <label className="csv-upload">{rows.length ? 'Replace participant list with CSV' : 'Import participant CSV'}<input type="file" accept=".csv,text/csv" onChange={(event) => void readCsv(event.target.files?.[0])} /></label>
            {resumeBatchId && <p className="stamping-note">Resuming draft batch <code>{resumeBatchId.slice(0, 8)}</code>. Re-upload the same participant file to continue staging. Staged participant data cannot be changed; start a new batch for corrections.</p>}
            {(resumeBatchId || pendingBatchKey) && <button className="button button-quiet" type="button" disabled={busy} onClick={() => { setResumeBatchId(''); setPendingBatchKey(''); setMessage('A new batch will be created on the next issuance.'); }}>Start a new batch instead</button>}
            {csvName && <span className="csv-summary">{csvName} · {rows.length} rows ready</span>}
            {rows.length > 0 && (
              <div className="participant-review">
                <div className="stamping-section-heading"><strong>{rows.length} participants in this batch</strong><button className="button button-quiet" type="button" onClick={() => { setRows([]); setCsvName('') }}>Clear list</button></div>
                <div className="participant-table" role="table" aria-label="Participant list for credential issuance">
                  <div className="participant-row participant-row-header" role="row">
                    <span role="columnheader">Name</span><span role="columnheader">Participant ID</span><span role="columnheader">Email</span><span role="columnheader">Action</span>
                  </div>
                  {rows.map((row, index) => (
                    <div className="participant-row" role="row" key={`${row.email}-${index}`}>
                      <span role="cell">{row.full_name}</span>
                      <span role="cell">{row.external_id || '—'}</span>
                      <span role="cell">{row.email}</span>
                      <span role="cell"><button className="button button-quiet" type="button" aria-label={`Remove ${row.full_name}`} onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}>Remove</button></span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <button className="button button-primary" disabled={busy || !rows.length || !selectedEvent || !selectedAchievement} onClick={() => void issueCsv()}>{busy ? 'Processing…' : `Issue ${rows.length || ''} credentials`}</button>
          </section>
        )}

        {canIssue && organization && (
          <section className="admin-card stamping-panel">
            <span className="eyebrow">{copyId.stampingWorkspace.eyebrow}</span>
            <h2>{copyId.stampingWorkspace.title}</h2>
            <p>{copyId.stampingWorkspace.description}</p>
            {!driveStampingOpen && (
              <button className="button button-secondary" onClick={() => setDriveStampingOpen(true)}>
                {copyId.stampingWorkspace.open}
              </button>
            )}
            {driveStampingOpen && (
              <Suspense fallback={<p className="admin-loading" role="status">{copyId.common.loading}…</p>}>
                <DriveStamping
                  organizationId={organization.id}
                  events={events}
                  achievements={achievements}
                />
              </Suspense>
            )}
          </section>
        )}

        <section className="admin-card batch-card"><span className="eyebrow">ISSUANCE HISTORY</span><h2>Recent batches</h2>
          {batches.length ? batches.map((batch) => (
            <div className="batch-history-item" key={batch.id}>
              <div className="batch-row">
                <div><strong>{batch.status.replaceAll('_', ' ')}</strong><small>{new Date(batch.created_at).toLocaleString()} · {batch.processed_count}/{batch.total} processed · {batch.succeeded} issued · {batch.failed} failed</small></div>
                <div className="credential-actions">
                  {canIssue && batch.status === 'draft' && <button className="button button-secondary" disabled={busy || !batch.event_id} onClick={() => {
                    if (batch.event_id) setSelectedEvent(batch.event_id)
                    setSelectedAchievement(batch.achievement_id)
                    setResumeBatchId(batch.id)
                    setMessage('Draft selected. Re-upload the same participant file to continue staging.')
                  }}>Resume upload</button>}
                  {canIssue && ['queued', 'processing'].includes(batch.status) && <button className="button button-secondary" disabled={busy} onClick={() => void continueBatch(batch)}>Continue issuance</button>}
                  {canIssue && batch.failed > 0 && <button className="button button-secondary" disabled={busy} onClick={() => void retryBatch(batch.id)}>Retry failed rows</button>}
                  {canIssue && batch.options?.sendEmail && ['completed', 'completed_with_errors'].includes(batch.status) && <button className="button button-secondary" disabled={busy} onClick={async () => {
                    setBusy(true)
                    setError('')
                    try {
                      const totals = await sendBatchEmails(batch.id, batch.id)
                      setMessage(`Email run checked. Sent: ${totals.sent}; failed: ${totals.failed}; throttled: ${totals.throttled}; pending confirmation: ${totals.pending}.`)
                    } catch (cause) {
                      setError(messageOf(cause))
                    } finally {
                      setBusy(false)
                    }
                  }}>Resume batch emails</button>}
                  {canIssue && <button className="button button-quiet" disabled={busy} onClick={() => {
                    if (batchDetailId === batch.id) {
                      setBatchDetailId('')
                      setBatchOutcomes([])
                    } else {
                      void loadBatchOutcomes(batch.id, 0).catch((cause: unknown) => setError(messageOf(cause)))
                    }
                  }}>{batchDetailId === batch.id ? 'Hide rows' : 'View rows'}</button>}
                </div>
              </div>
              {batchDetailId === batch.id && (
                <div className="batch-outcomes" aria-label="Issuance row outcomes">
                  <ul className="admin-list">
                    {batchOutcomes.map((row) => (
                      <li key={row.rowNumber}>
                        <span>Row {row.rowNumber} · {row.status.replaceAll('_', ' ')}</span>
                        <small>{row.serialNumber ?? row.errorCode ?? 'No credential reference'}</small>
                      </li>
                    ))}
                    {!batchOutcomes.length && <li><span>No staged rows on this page.</span></li>}
                  </ul>
                  <div className="credential-actions">
                    <button className="button button-quiet" disabled={busy || batchDetailPage === 0} onClick={() => void loadBatchOutcomes(batch.id, batchDetailPage - 1).catch((cause: unknown) => setError(messageOf(cause)))}>Previous rows</button>
                    <button className="button button-quiet" disabled={busy || batchOutcomes.length < 50} onClick={() => void loadBatchOutcomes(batch.id, batchDetailPage + 1).catch((cause: unknown) => setError(messageOf(cause)))}>Next rows</button>
                  </div>
                </div>
              )}
            </div>
          )) : <p className="admin-empty">No issuance batches yet.</p>}
        </section>

        <section className="admin-card batch-card"><span className="eyebrow">CREDENTIALS</span><h2>Recent credentials</h2>
          {credentials.length ? credentials.map((credential) => (
            <div className="batch-row" key={credential.id}>
              <div><strong>{credential.serial_number}</strong><small>{credential.status} · {credential.visibility} · {credential.issued_at ? new Date(credential.issued_at).toLocaleDateString() : 'Not issued'}</small></div>
              <div className="credential-actions">
                {credential.status === 'issued' && <Link className="button button-secondary" to={`/c/${credential.id}`} target="_blank">Open share page</Link>}
                {credential.status === 'issued' && canIssue && <button className="button button-secondary" disabled={busy} onClick={() => void downloadPdf(credential)}>Download PDF</button>}
                {credential.status === 'issued' && canIssue && <button className="button button-quiet" disabled={busy} onClick={() => void resendCredentialEmail(credential.id, pendingEmailIds[credential.id] === true)}>{pendingEmailIds[credential.id] ? 'Start new email attempt' : 'Resend email'}</button>}
                {credential.status === 'issued' && canRevoke && <select className="member-role-select" aria-label={`Visibility for ${credential.serial_number}`} value={credential.visibility} disabled={busy} onChange={(event) => void updateVisibility(credential.id, event.target.value as Credential['visibility'])}><option value="unlisted">Unlisted</option><option value="public">Public</option></select>}
                {canRevoke && credential.status === 'issued' && (revokeId === credential.id ? (
                  <div className="revoke-inline"><input aria-label="Revocation reason" value={revokeReason} onChange={(event) => setRevokeReason(event.target.value)} placeholder="Reason required" maxLength={1000} /><button className="button button-danger" disabled={busy || !revokeReason.trim()} onClick={() => void revokeCredential(credential.id)}>Confirm revoke</button><button className="button button-quiet" onClick={() => { setRevokeId(''); setRevokeReason('') }}>Cancel</button></div>
                ) : <button className="button button-quiet" onClick={() => setRevokeId(credential.id)}>Revoke</button>)}
              </div>
            </div>
          )) : <p className="admin-empty">No credentials issued yet.</p>}
        </section>

        {canRevoke && (
          <section className="admin-card batch-card">
            <span className="eyebrow">RECIPIENT PRIVACY</span><h2>Recipient records</h2>
            <p>Anonymizing a recipient clears identifying data and signed payloads, and revokes associated credentials. Credential IDs and revocation records remain.</p>
            {recipients.length ? recipients.map((recipient) => (
              <div className="batch-row" key={recipient.id}>
                <div><strong>{recipient.full_name ?? 'Anonymized recipient'}</strong><small>{recipient.email ?? 'No email retained'}{recipient.anonymized_at ? ` · deleted ${new Date(recipient.anonymized_at).toLocaleDateString()}` : ''}</small></div>
                {!recipient.anonymized_at && (anonymizeId === recipient.id ? (
                  <div className="revoke-inline"><span className="privacy-warning">This action cannot be undone.</span><button className="button button-danger" disabled={busy} onClick={() => void anonymizeRecipient(recipient.id)}>Confirm deletion</button><button className="button button-quiet" onClick={() => setAnonymizeId('')}>Cancel</button></div>
                ) : <button className="button button-quiet" disabled={busy} onClick={() => setAnonymizeId(recipient.id)}>Anonymize</button>)}
              </div>
            )) : <p className="admin-empty">No recipient records.</p>}
          </section>
        )}

        {canRevoke && (
          <section className="admin-card batch-card">
            <span className="eyebrow">AUDIT TRAIL</span><h2>Recent activity</h2>
            {auditEntries.length ? auditEntries.map((entry) => (
              <div className="batch-row" key={entry.id}>
                <div><strong>{entry.action.replaceAll('.', ' ')}</strong><small>{entry.entity_type}{entry.entity_id ? ` · ${entry.entity_id}` : ''} · {new Date(entry.created_at).toLocaleString()}</small></div>
              </div>
            )) : <p className="admin-empty">No audit activity recorded.</p>}
          </section>
        )}
        <button className="admin-reload" disabled={busy} onClick={() => { if (organization) void loadDashboard(organization.id, dashboardRole).catch((cause: unknown) => setError(messageOf(cause))) }}>Refresh dashboard</button>
      </main>
    </div>
  )
}
