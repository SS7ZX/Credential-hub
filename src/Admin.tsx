import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import Papa from 'papaparse'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'

type Organization = { id: string; name: string; slug: string }
type Membership = { role: 'owner' | 'admin' | 'issuer' | 'viewer'; organizations: Organization }
type EventRecord = { id: string; name: string; event_date: string | null; status: string }
type Achievement = { id: string; name: string; event_id: string | null; criteria_narrative: string | null }
type Batch = { id: string; created_at: string; status: string; total: number; processed_count: number; succeeded: number; failed: number }
type Credential = { id: string; serial_number: string; issued_at: string | null; status: string; visibility: string; achievement_id: string | null }
type OrganizationMember = { user_id: string; role: 'owner' | 'admin' | 'issuer' | 'viewer'; joined_at: string }
type Recipient = { id: string; full_name: string | null; email: string | null; anonymized_at: string | null }
type AuditEntry = { id: string; action: string; entity_type: string; entity_id: string | null; metadata: Record<string, unknown>; created_at: string }
type CsvRow = Record<string, string>

const csvColumns = ['full_name', 'email']

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}

function AdminHeader() {
  return (
    <header className="topbar">
      <Link className="brand" to="/"><span className="brand-mark">t</span><span>credential hub</span></Link>
      <Link className="nav-link" to="/">Public credential portal <span aria-hidden="true">↗</span></Link>
    </header>
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
  const [achievementName, setAchievementName] = useState('')
  const [achievementDescription, setAchievementDescription] = useState('')
  const [achievementCriteria, setAchievementCriteria] = useState('')
  const [achievementEventId, setAchievementEventId] = useState('')
  const [memberEmail, setMemberEmail] = useState('')
  const [memberRole, setMemberRole] = useState<'admin' | 'issuer' | 'viewer'>('viewer')
  const [selectedEvent, setSelectedEvent] = useState('')
  const [selectedAchievement, setSelectedAchievement] = useState('')
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
      supabase.from('events').select('id, name, event_date, status').eq('organization_id', organizationId).order('created_at', { ascending: false }),
      supabase.from('achievements').select('id, name, event_id, criteria_narrative').eq('organization_id', organizationId).order('created_at', { ascending: false }),
      supabase.from('issuance_batches').select('id, created_at, status, total, processed_count, succeeded, failed').eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(10),
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
      <main className="portal admin-portal">
        <AdminHeader />
        <section className="admin-content">
          <div className="admin-heading"><span className="eyebrow">ISSUER WORKSPACE</span><h1>Workspace unavailable</h1></div>
          {error && <p className="admin-error" role="alert">{error}</p>}
          <button className="button button-secondary" disabled={busy} onClick={() => {
            setBusy(true)
            void loadOrganizations().catch((cause: unknown) => setError(messageOf(cause))).finally(() => setBusy(false))
          }}>Try again</button>
        </section>
      </main>
    )
  }

  if (organizationsLoaded && !memberships.length && !organization) {
    return (
      <main className="portal admin-portal">
        <AdminHeader />
        <section className="admin-content">
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
        </section>
      </main>
    )
  }

  const selectedMember = memberships.find((item) => item.organizations.id === organization?.id)
  const selectedRole = selectedMember?.role ?? role
  const dashboardRole = selectedRole ?? 'viewer'
  const canIssue = selectedRole === 'owner' || selectedRole === 'admin' || selectedRole === 'issuer'
  const canRevoke = selectedRole === 'owner' || selectedRole === 'admin'

  async function createEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !organization) return
    setBusy(true)
    setError('')
    try {
      const { error: insertError } = await supabase.from('events').insert({
        organization_id: organization.id,
        name: eventName.trim().replace(/\s+/g, ' '),
        status: 'active',
      })
      if (insertError) throw insertError
      setEventName('')
      setMessage('Event created.')
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
        description: achievementDescription.trim(),
        criteria_narrative: achievementCriteria.trim(),
        status: 'active',
      })
      if (insertError) throw insertError
      setAchievementName('')
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
              : result.errors[0]?.message ?? (result.data.length > 1000
                ? 'A batch can contain at most 1,000 recipients.'
                : 'The CSV has no recipient rows.'),
          )
          return
        }
        setRows(result.data)
        setMessage(`${result.data.length} recipient rows loaded.`)
      },
      error: (cause) => setError(cause.message),
    })
  }

  async function issueCsv() {
    if (!supabase || !organization || !selectedEvent || !selectedAchievement || !rows.length) return
    setBusy(true)
    setError('')
    setMessage('Creating issuance batch…')
    try {
      const { data: created, error: createError } = await supabase.functions.invoke<{ id: string }>('issue-batch', {
        body: {
          action: 'create',
          organizationId: organization.id,
          eventId: selectedEvent,
          achievementId: selectedAchievement,
          sourceFilename: csvName,
          rowsTotal: rows.length,
          options: { duplicatePolicy, visibility, sendEmail },
        },
      })
      if (createError) throw createError
      if (!created?.id) throw new Error('Issuance service did not return a batch ID.')
      for (let offset = 0; offset < rows.length; offset += 50) {
        const chunk = rows.slice(offset, offset + 50).map((payload, index) => ({
          rowNumber: offset + index + 1,
          payload,
        }))
        const { data, error: processError } = await supabase.functions.invoke<{ rows: Array<{ status: string }> }>('issue-batch', {
          body: { action: 'process', batchId: created.id, rows: chunk },
        })
        if (processError) throw processError
        const issuedThrough = Math.min(offset + chunk.length, rows.length)
        setMessage(`Processing ${issuedThrough} of ${rows.length} recipients…`)
        if (!data) throw new Error('Issuance service returned no batch progress.')
      }
      if (sendEmail) {
        const { data: issued, error: issuedError } = await supabase
          .from('credentials')
          .select('id')
          .eq('organization_id', organization.id)
          .eq('batch_id', created.id)
          .eq('status', 'issued')
        if (issuedError) throw issuedError
        if (issued?.length) {
          const totals = { sent: 0, failed: 0, throttled: 0 }
          for (let offset = 0; offset < issued.length; offset += 50) {
            const { data: emailResult, error: emailError } = await supabase.functions.invoke<typeof totals>('send-emails', {
              body: {
                organizationId: organization.id,
                credentialIds: issued.slice(offset, offset + 50).map((credential) => credential.id),
              },
            })
            if (emailError) throw emailError
            totals.sent += emailResult?.sent ?? 0
            totals.failed += emailResult?.failed ?? 0
            totals.throttled += emailResult?.throttled ?? 0
          }
          setMessage(`Batch completed. Emails sent: ${totals.sent}; failed: ${totals.failed}; throttled by daily limit: ${totals.throttled}.`)
        }
      }
      setRows([])
      setCsvName('')
      if (!sendEmail) setMessage('Issuance batch processed. Failed rows can be retried from the batch list.')
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

  async function retryBatch(batchId: string) {
    if (!supabase || !organization) return
    setBusy(true)
    setError('')
    try {
      const { error: retryError } = await supabase.functions.invoke('issue-batch', {
        body: { action: 'retry-failed', batchId, limit: 50 },
      })
      if (retryError) throw retryError
      setMessage('Retry request completed.')
      await loadDashboard(organization.id, dashboardRole)
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
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
        const responseText = await response.text()
        let detail = responseText
        try {
          const responseBody = JSON.parse(responseText) as { error?: string }
          detail = responseBody.error ?? responseText
        } catch {
          detail = responseText
        }
        throw new Error(detail || `PDF generation failed (${response.status}).`)
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
      const { error: rpcError } = await supabase.rpc('anonymize_recipient', { p_recipient_id: recipientId })
      if (rpcError) throw rpcError
      setAnonymizeId('')
      setMessage('Recipient data removed. Associated credentials were revoked and their IDs retained.')
      await loadDashboard(organization.id, dashboardRole)
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="portal admin-portal">
      <AdminHeader />
      <section className="admin-content">
        <div className="admin-heading">
          <span className="eyebrow">ISSUER WORKSPACE</span>
          <div className="admin-title-row"><div><h1>Credential dashboard</h1><p>Manage events, achievements, and credential issuance.</p></div><button className="admin-signout" onClick={onSignOut}>Sign out</button></div>
        </div>
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
              <span className="eyebrow">EVENTS</span><h2>Create event</h2>
              <label>Event name<input value={eventName} onChange={(event) => setEventName(event.target.value)} required maxLength={200} /></label>
              <button className="button button-primary" disabled={busy || !eventName.trim()}>{busy ? 'Saving…' : 'Add event'}</button>
              <ul className="admin-list">{events.slice(0, 5).map((item) => <li key={item.id}><span>{item.name}</span><small>{item.event_date ?? item.status}</small></li>)}</ul>
            </form>

            <form className="admin-card admin-form" onSubmit={(event) => void createAchievement(event)}>
              <span className="eyebrow">ACHIEVEMENTS</span><h2>Create achievement</h2>
              <label>Achievement name<input value={achievementName} onChange={(event) => setAchievementName(event.target.value)} required maxLength={200} /></label>
              <label>Event<select value={achievementEventId} onChange={(event) => setAchievementEventId(event.target.value)}><option value="">Not linked to an event</option>{events.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
              <label>Description<textarea value={achievementDescription} onChange={(event) => setAchievementDescription(event.target.value)} required maxLength={2000} rows={2} /></label>
              <label>Criteria narrative<textarea value={achievementCriteria} onChange={(event) => setAchievementCriteria(event.target.value)} required maxLength={4000} rows={2} /></label>
              <button className="button button-primary" disabled={busy || !achievementName.trim() || !achievementDescription.trim() || !achievementCriteria.trim()}>{busy ? 'Saving…' : 'Add achievement'}</button>
              <ul className="admin-list">{achievements.slice(0, 5).map((item) => <li key={item.id}><span>{item.name}</span><small>{item.criteria_narrative ? 'Ready to issue' : 'Add criteria before issue'}</small></li>)}</ul>
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
            <span className="eyebrow">BULK ISSUANCE</span><h2>Issue credentials from CSV</h2>
            <p>Required columns: <code>full_name,email</code>. Optional: <code>issued_on,expires_on</code>. Recipient name-display consent is collected separately through the recipient management link. Rows are processed in server-side chunks of 50.</p>
            <div className="issuance-controls">
              <label>Event<select value={selectedEvent} onChange={(event) => setSelectedEvent(event.target.value)} required><option value="">Choose event</option>{events.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
              <label>Achievement<select value={selectedAchievement} onChange={(event) => setSelectedAchievement(event.target.value)} required><option value="">Choose achievement</option>{achievements.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
              <label>Duplicate policy<select value={duplicatePolicy} onChange={(event) => setDuplicatePolicy(event.target.value as typeof duplicatePolicy)}><option value="skip">Skip duplicates (default)</option><option value="reissue">Reissue</option><option value="error">Mark as error</option></select></label>
              <label>Visibility<select value={visibility} onChange={(event) => setVisibility(event.target.value as typeof visibility)}><option value="unlisted">Unlisted (default)</option><option value="public">Public</option></select></label>
            </div>
            <label className="email-option"><input type="checkbox" checked={sendEmail} onChange={(event) => setSendEmail(event.target.checked)} /> Send credential emails after successful issuance (daily plan limit applies)</label>
            <label className="csv-upload">Choose recipient CSV<input type="file" accept=".csv,text/csv" onChange={(event) => void readCsv(event.target.files?.[0])} /></label>
            {csvName && <span className="csv-summary">{csvName} · {rows.length} rows ready</span>}
            <button className="button button-primary" disabled={busy || !rows.length || !selectedEvent || !selectedAchievement} onClick={() => void issueCsv()}>{busy ? 'Processing…' : `Issue ${rows.length || ''} credentials`}</button>
          </section>
        )}

        <section className="admin-card batch-card"><span className="eyebrow">ISSUANCE HISTORY</span><h2>Recent batches</h2>
          {batches.length ? batches.map((batch) => (
            <div className="batch-row" key={batch.id}><div><strong>{batch.status.replaceAll('_', ' ')}</strong><small>{new Date(batch.created_at).toLocaleString()} · {batch.processed_count}/{batch.total} processed · {batch.succeeded} issued · {batch.failed} failed</small></div>{batch.failed > 0 && canIssue && <button className="button button-secondary" disabled={busy} onClick={() => void retryBatch(batch.id)}>Retry failed rows</button>}</div>
          )) : <p className="admin-empty">No issuance batches yet.</p>}
        </section>

        <section className="admin-card batch-card"><span className="eyebrow">CREDENTIALS</span><h2>Recent credentials</h2>
          {credentials.length ? credentials.map((credential) => (
            <div className="batch-row" key={credential.id}>
              <div><strong>{credential.serial_number}</strong><small>{credential.status} · {credential.visibility} · {credential.issued_at ? new Date(credential.issued_at).toLocaleDateString() : 'Not issued'}</small></div>
              <div className="credential-actions">
                {credential.status === 'issued' && <Link className="button button-secondary" to={`/c/${credential.id}`} target="_blank">Open share page</Link>}
                {credential.status === 'issued' && canIssue && <button className="button button-secondary" disabled={busy} onClick={() => void downloadPdf(credential)}>Download PDF</button>}
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
      </section>
    </main>
  )
}
