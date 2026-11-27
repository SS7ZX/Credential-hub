import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { BrowserRouter, Link, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
const Admin = lazy(() => import('./Admin'))
import { getPublicSiteUrl } from './config/brand'
import { supabase } from './lib/supabase'
import { requestErrorMessage } from './lib/request-error'
import { NetworkStatus } from './components/NetworkStatus'
import { copyId } from './copy/id'
import './App.css'

const StyleguidePage = import.meta.env.DEV
  ? lazy(() => import('./pages/StyleguidePage'))
  : null

type VerificationCheck = { name: string; passed: boolean; detail: string }
type VerificationResult = {
  valid: boolean
  summary: string
  checks: VerificationCheck[]
  credential?: {
    id?: string
    issuer?: string | { id?: string; name?: string }
    validFrom?: string
    validUntil?: string
    achievement?: { name?: string; description?: string; image?: string }
  }
  error?: string
}
type PublicCredential = {
  revoked?: boolean
  credential: {
    id?: string
    issuer?: string | { id?: string; name?: string }
    validFrom?: string
    validUntil?: string
    credentialSubject?: {
      name?: string
      achievement?: { name?: string; description?: string; image?: string }
    }
  }
}

function OrganizationInvitationPage() {
  const [searchParams] = useSearchParams()
  const invitationId = searchParams.get('invitation') ?? ''
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(Boolean(supabase))
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!supabase) return
    let active = true
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setLoading(false)
    })
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return
      if (sessionError) setError(requestErrorMessage(sessionError, copyId.errors.requestFailed))
      setSession(data.session)
      setLoading(false)
    })
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    setBusy(true)
    setError('')
    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      })
      if (signInError) throw signInError
      setSession(data.session)
      setPassword('')
    } catch (cause) {
      setError(requestErrorMessage(cause, copyId.errors.signInFailed))
    } finally {
      setBusy(false)
    }
  }

  async function acceptInvitation() {
    if (!supabase || !invitationId) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const { data, error: invokeError } = await supabase.functions.invoke<{
        organizationId: string
        organizationName: string
        role: 'admin' | 'issuer' | 'viewer'
      }>('accept-organization-invitation', { body: { invitationId } })
      if (invokeError) throw invokeError
      if (!data?.organizationName) throw new Error('Invitation service returned an invalid response.')
      setMessage(`You joined ${data.organizationName} as ${data.role}.`)
    } catch (cause) {
      setError(requestErrorMessage(cause, copyId.errors.invitationFailed))
    } finally {
      setBusy(false)
    }
  }

  return (
    <PortalLayout>
      <section className="admin-login">
        <span className="eyebrow">ORGANIZATION INVITATION</span>
        <h1>Join your organization</h1>
        {!invitationId && <p className="admin-error" role="alert">This invitation link is missing its invitation identifier.</p>}
        {!supabase && <p className="admin-error" role="alert">Organization invitations are not configured.</p>}
        {loading && <p role="status">Checking your sign-in…</p>}
        {error && <p className="admin-error" role="alert">{error}</p>}
        {message && (
          <div className="admin-card">
            <p className="admin-success" role="status">{message}</p>
            <Link className="button button-primary" to="/admin">Open issuer workspace</Link>
          </div>
        )}
        {!loading && !session && invitationId && (
          <form className="admin-card admin-form" onSubmit={(event) => void signIn(event)}>
            <p>Use the secure sign-in link in your invitation email. If you already have a password for this account, you can sign in here.</p>
            <label>Email<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
            <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
            <button className="button button-secondary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          </form>
        )}
        {!loading && session && invitationId && !message && (
          <div className="admin-card admin-form">
            <p>Signed in as <strong>{session.user.email ?? 'your account'}</strong>. Acceptance requires a verified email matching the invitation.</p>
            <button className="button button-primary" disabled={busy} onClick={() => void acceptInvitation()}>
              {busy ? 'Accepting…' : 'Accept invitation'}
            </button>
          </div>
        )}
      </section>
    </PortalLayout>
  )
}

function Header() {
  return (
    <header className="topbar">
      <Link className="brand" to="/">
        <span className="brand-mark" aria-hidden="true">t</span>
        <span>credential hub</span>
      </Link>
      <nav aria-label="Navigasi utama">
        <Link className="nav-link" to="/#verify">Verify a credential <span aria-hidden="true">↗</span></Link>
      </nav>
    </header>
  )
}

function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="portal">
      <a className="skip-link" href="#main-content">{copyId.navigation.skipToMain}</a>
      <Header />
      <NetworkStatus />
      <main id="main-content">{children}</main>
      <footer className="footer">
        <span>Credentials you can trust.</span>
        <span>Issued with Open Badges 3.0</span>
      </footer>
    </div>
  )
}

function VerificationForm({ initialValue = '' }: { initialValue?: string }) {
  const [value, setValue] = useState(initialValue)
  const [fileName, setFileName] = useState('')
  const [result, setResult] = useState<VerificationResult | null>(null)
  const [error, setError] = useState(supabase ? '' : 'Credential service is not configured yet.')
  const [busy, setBusy] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!scannerOpen || !videoRef.current) return
    let active = true
    let scanner: import('qr-scanner').default | undefined
    void import('qr-scanner').then(({ default: QrScanner }) => {
      if (!active || !videoRef.current) return
      scanner = new QrScanner(
        videoRef.current,
        (decoded) => {
          scanner?.stop()
          setScannerOpen(false)
          let match: RegExpMatchArray | null = null
          try {
            const siteUrl = getPublicSiteUrl()
            const url = new URL(decoded.data, siteUrl)
            if (url.origin === siteUrl) {
              match = url.pathname.match(/^\/(?:c|verify)\/([0-9a-f-]{36})$/i)
            }
          } catch {
            match = null
          }
          if (match) navigate(`/verify/${match[1]}`)
          else {
            setValue(decoded.data)
            setError('That QR code is not a credential link for this site. You can paste its credential ID or signed VC-JWT instead.')
          }
        },
        { onDecodeError: () => undefined, highlightScanRegion: true, highlightCodeOutline: true },
      )
      return scanner.start().catch((cause: unknown) => {
        if (!active) return
        setError(requestErrorMessage(cause, copyId.errors.cameraUnavailable))
        setScannerOpen(false)
      })
    }).catch((cause: unknown) => {
      if (!active) return
      setError(requestErrorMessage(cause, copyId.errors.cameraUnavailable))
      setScannerOpen(false)
    })
    return () => {
      active = false
      scanner?.destroy()
    }
  }, [navigate, scannerOpen])

  const verify = useCallback(async (input: string) => {
    if (!supabase) {
      setError('Verification is not configured yet. Please try again later.')
      return
    }
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const trimmed = input.trim()
      const idRoute = trimmed.match(/^\/?(?:c|verify)\/([0-9a-f-]{36})$/i)
      let credentialUrl: RegExpMatchArray | null = null
      try {
        const url = new URL(trimmed)
        if (url.origin === getPublicSiteUrl()) {
          credentialUrl = url.pathname.match(/^\/(?:c|verify)\/([0-9a-f-]{36})$/i)
        }
      } catch {
        credentialUrl = null
      }
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)
      const body = uuid || idRoute || credentialUrl
        ? { id: uuid ? trimmed : (idRoute ?? credentialUrl)![1] }
        : trimmed.startsWith('http') ? { url: trimmed } : { jws: trimmed }
      const { data, error: invokeError } = await supabase.functions.invoke<VerificationResult>('verify-credential', { body })
      if (invokeError) throw invokeError
      if (!data) throw new Error('Verification service returned no result.')
      setResult(data)
    } catch (cause) {
      setError(requestErrorMessage(cause, copyId.errors.verificationFailed))
    } finally {
      setBusy(false)
    }
  }, [])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void verify(value)
  }

  async function uploadFile(file?: File) {
    if (!file) return
    if (file.size > 1_000_000) {
      setError('The signed credential file must be smaller than 1 MB.')
      return
    }
    setFileName(file.name)
    setValue(await file.text())
    setError('')
  }

  return (
    <section className="verify-card" id="verify">
      <div className="card-heading">
        <span className="eyebrow">INDEPENDENT VERIFICATION</span>
        <h2>Check a credential</h2>
        <p>Enter a credential link or ID, paste a signed VC-JWT, or scan its QR code.</p>
      </div>
      <form onSubmit={submit}>
        <label className="input-label" htmlFor="credential-input">Credential link, ID, or signed VC-JWT</label>
        <textarea
          id="credential-input"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Paste a credential link or compact VC-JWT"
          rows={3}
          maxLength={1_000_000}
        />
        <div className="form-actions">
          <button className="button button-primary" type="submit" disabled={busy || !value.trim()}>
            {busy ? 'Checking…' : 'Verify credential'} <span aria-hidden="true">→</span>
          </button>
          <label className="button button-secondary file-button">
            Upload signed file
            <input type="file" accept=".jwt,.txt,.vcjwt,text/plain,application/vc+jwt" onChange={(event) => void uploadFile(event.target.files?.[0])} />
          </label>
          <button className="button button-quiet" type="button" onClick={() => { setError(''); setScannerOpen((open) => !open) }}>
            Scan QR
          </button>
        </div>
        {fileName && <span className="file-name">Selected: {fileName}</span>}
      </form>

      {scannerOpen && (
        <div className="scanner-panel">
          <video ref={videoRef} className="scanner-video" muted playsInline aria-label="QR code camera preview" />
          <button className="button button-quiet" type="button" onClick={() => setScannerOpen(false)}>Close camera</button>
        </div>
      )}
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      {result && <VerificationSummary result={result} />}
    </section>
  )
}

function VerificationSummary({ result }: { result: VerificationResult }) {
  const issuer = typeof result.credential?.issuer === 'string'
    ? result.credential.issuer
    : result.credential?.issuer?.name ?? result.credential?.issuer?.id
  return (
    <section className={`result-card ${result.valid ? 'result-valid' : 'result-invalid'}`} aria-live="polite">
      <div className="result-title">
        <span className="result-icon" aria-hidden="true">{result.valid ? '✓' : '!'}</span>
        <div>
          <span className="eyebrow">{result.valid ? 'VERIFIED' : 'NOT VERIFIED'}</span>
          <h3>{result.valid ? 'Credential is valid' : 'Credential is not valid'}</h3>
          <p>{result.summary}</p>
        </div>
      </div>
      {result.credential && (
        <dl className="credential-details">
          {result.credential.achievement?.name && <><dt>Achievement</dt><dd>{result.credential.achievement.name}</dd></>}
          {issuer && <><dt>Issuer</dt><dd>{issuer}</dd></>}
          {result.credential.validFrom && <><dt>Issued</dt><dd>{new Date(result.credential.validFrom).toLocaleDateString()}</dd></>}
        </dl>
      )}
      <ul className="check-list">
        {result.checks?.map((check) => (
          <li key={check.name}>
            <span className={check.passed ? 'check-pass' : 'check-fail'} aria-hidden="true">{check.passed ? '✓' : '×'}</span>
            <span><strong>{check.name}</strong><small>{check.detail}</small></span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function HomePage() {
  return (
    <PortalLayout>
      <section className="hero-section">
        <div className="hero-copy">
          <span className="eyebrow"><span className="eyebrow-dot" /> DIGITAL CREDENTIALS, VERIFIED</span>
          <h1>Proof that<br /><em>moves you forward.</em></h1>
          <p>Secure, shareable credentials that make every achievement count. Verify an award in seconds, with confidence.</p>
          <a className="button button-primary hero-button" href="#verify">Verify a credential <span aria-hidden="true">↓</span></a>
          <div className="trust-note"><span className="trust-check">✓</span> Open standards. Real verification. No account needed.</div>
        </div>
        <div className="credential-art" aria-hidden="true">
          <div className="art-glow" />
          <div className="art-card art-card-back"><span>ACHIEVEMENT</span><span className="art-seal" aria-hidden="true">CH</span></div>
          <div className="art-card art-card-main">
            <div className="art-top"><span className="brand-mark">t</span><span className="verified-tag">✓ VERIFIED</span></div>
            <span className="art-label">CERTIFICATE OF ACHIEVEMENT</span>
            <span className="art-star" aria-hidden="true" />
            <strong>Every skill<br />has a story.</strong>
            <span className="art-rule" />
            <span className="art-caption">Issued by a trusted organization</span>
          </div>
          <div className="floating-seal"><span>✓</span><small>AUTHENTIC</small></div>
        </div>
      </section>
      <section className="how-section">
        <span className="eyebrow">SIMPLE BY DESIGN</span>
        <h2>Trust, without the guesswork.</h2>
        <div className="how-grid">
          <article><h3>Share</h3><p>Open the credential link or scan its QR code.</p></article>
          <article><h3>Check</h3><p>We verify the signature, issuer, dates, and status.</p></article>
          <article><h3>Know</h3><p>See a clear result backed by trusted issuer keys.</p></article>
        </div>
      </section>
      <VerificationForm />
    </PortalLayout>
  )
}

function CredentialPage() {
  const { id = '' } = useParams()
  const [credential, setCredential] = useState<PublicCredential['credential'] | null>(null)
  const [redacted, setRedacted] = useState(false)
  const [result, setResult] = useState<VerificationResult | null>(null)
  const [qr, setQr] = useState('')
  const [error, setError] = useState(supabase ? '' : 'Credential service is not configured yet.')
  const [copied, setCopied] = useState(false)
  const shareUrl = `${getPublicSiteUrl()}/c/${encodeURIComponent(id)}`

  useEffect(() => {
    let active = true
    if (!supabase) return
    void Promise.all([
      supabase.functions.invoke<PublicCredential>('get-credential', { body: { id, format: 'json' } }),
      supabase.functions.invoke<VerificationResult>('verify-credential', { body: { id } }),
      import('qrcode').then(({ default: QRCode }) =>
        QRCode.toDataURL(shareUrl, { width: 220, margin: 1, color: { dark: '#12231e', light: '#ffffff' } })
      ),
    ]).then(([credentialResponse, verifyResponse, qrData]) => {
      if (!active) return
      if (credentialResponse.error) throw credentialResponse.error
      if (verifyResponse.error) throw verifyResponse.error
      setCredential(credentialResponse.data?.credential ?? null)
      setRedacted(credentialResponse.data?.revoked ?? false)
      setResult(verifyResponse.data ?? null)
      setQr(qrData)
      if (!credentialResponse.data) setError('This credential is not available.')
    }).catch((cause: unknown) => {
      if (active) setError(requestErrorMessage(cause, copyId.errors.credentialUnavailable))
    })
    return () => { active = false }
  }, [id, shareUrl])

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch (cause) {
      setError(requestErrorMessage(cause, copyId.errors.copyUnavailable))
    }
  }

  const subject = credential?.credentialSubject
  const achievement = subject?.achievement
  const issuer = typeof credential?.issuer === 'object' ? credential.issuer.name : credential?.issuer

  return (
    <PortalLayout>
      <section className="share-page">
        <Link className="back-link" to="/">← Back to verification</Link>
        {error ? <p className="alert alert-error" role="alert">{error}</p> : !credential ? (
          <div className="loading-card" role="status">Loading credential…</div>
        ) : (
          <>
            <div className={`share-status ${result?.valid ? 'status-good' : 'status-bad'}`}>
              <span aria-hidden="true">{result?.valid ? '✓' : '!'}</span>
              <div><strong>{result?.valid ? 'Verified credential' : 'Could not verify credential'}</strong><small>{result?.summary}</small></div>
            </div>
            <article className="share-credential">
              <span className="eyebrow">{redacted ? 'REDACTED CREDENTIAL' : 'DIGITAL CREDENTIAL'}</span>
              <div className="share-emblem" aria-hidden="true">{redacted ? '×' : 'CH'}</div>
              {redacted ? (
                <>
                  <h1>Credential data deleted</h1>
                  <p className="achievement-description">Recipient data and signed content were removed. The credential ID and revocation record remain for audit.</p>
                  <code className="redacted-id">{credential.id}</code>
                </>
              ) : (
                <>
                  {achievement?.image && <img className="achievement-image" src={achievement.image} alt="" />}
                  <h1>{achievement?.name ?? 'Achievement credential'}</h1>
                  {subject?.name && <p className="recipient-name">Awarded to <strong>{subject.name}</strong></p>}
                  {achievement?.description && <p className="achievement-description">{achievement.description}</p>}
                  <div className="issued-by">Issued by <strong>{issuer ?? 'Credential issuer'}</strong>{credential.validFrom && <span>{new Date(credential.validFrom).toLocaleDateString()}</span>}</div>
                </>
              )}
            </article>
            <div className="share-actions">
              <div className="qr-card"><img src={qr} alt="QR code linking to this credential" /><span>Scan to verify</span></div>
              <div className="share-controls">
                <h2>Share your achievement</h2>
                <p>Anyone with this link can see this credential and check its authenticity.</p>
                <button className="button button-primary" type="button" onClick={() => void copyLink()}>{copied ? 'Copied!' : 'Copy credential link'} <span aria-hidden="true">↗</span></button>
                <a className="button button-secondary" href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`} target="_blank" rel="noreferrer">Share on LinkedIn ↗</a>
              </div>
            </div>
          </>
        )}
      </section>
    </PortalLayout>
  )
}

function VerifyRoute() {
  const { id = '' } = useParams()
  return (
    <PortalLayout>
      <section className="verify-route">
        <Link className="back-link" to="/">← Back to portal</Link>
        <h1>Credential verification</h1>
        <p>Check this credential against its issuer and current status.</p>
        <VerificationForm key={id} initialValue={id} />
      </section>
    </PortalLayout>
  )
}

function NotFound() {
  return <PortalLayout><section className="not-found"><span className="eyebrow">NOT FOUND</span><h1>This link has gone quiet.</h1><p>We couldn't find the page you were looking for.</p><Link className="button button-primary" to="/">Back to portal</Link></section></PortalLayout>
}

function AdminRoute() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(Boolean(supabase))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!supabase) return
    let active = true
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setLoading(false)
    })
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return
      if (sessionError) setError(requestErrorMessage(sessionError, copyId.errors.requestFailed))
      setSession(data.session)
      setLoading(false)
    })
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    setError('')
    setLoading(true)
    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      })
      if (signInError) throw signInError
      setSession(data.session)
    } catch (cause) {
      setError(requestErrorMessage(cause, copyId.errors.signInFailed))
    } finally {
      setLoading(false)
    }
  }

  async function signOut() {
    if (!supabase) return
    try {
      const { error: signOutError } = await supabase.auth.signOut()
      if (signOutError) throw signOutError
    } catch (cause) {
      setError(requestErrorMessage(cause, copyId.errors.signOutFailed))
    }
  }

  if (!supabase) {
    return <PortalLayout><section className="not-found"><h1>Admin is not configured</h1><p>Set the public Supabase URL and anon key in the local environment.</p></section></PortalLayout>
  }
  if (loading) {
    return <PortalLayout><section className="loading-card" role="status">Loading your workspace…</section></PortalLayout>
  }
  if (session) {
    return (
      <Suspense fallback={<PortalLayout><section className="loading-card" role="status">{copyId.common.loading}…</section></PortalLayout>}>
        <Admin session={session} onSignOut={() => void signOut()} />
      </Suspense>
    )
  }

  return (
    <PortalLayout>
      <section className="admin-login">
        <span className="eyebrow">ISSUER WORKSPACE</span>
        <h1>Welcome back.</h1>
        <p>Sign in with your organization account to manage credentials.</p>
        <form className="admin-card admin-form" onSubmit={(event) => void signIn(event)}>
          <label>Email<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          {error && <p className="admin-error" role="alert">{error}</p>}
          <button className="button button-primary" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
        </form>
      </section>
    </PortalLayout>
  )
}

type RecipientManagedCredential = {
  credentialId: string
  serialNumber: string
  visibility: 'public' | 'unlisted'
  issuedAt: string | null
  achievementName: string | null
  maskedNameConsent: boolean
  fullNameConsent: boolean
}

function RecipientManagementPage() {
  const [initialLink] = useState(() => {
    const token = window.location.hash.slice(1)
    return /^[0-9a-f]{64}$/.test(token)
      ? { token, error: '' }
      : { token: '', error: 'This management link is missing or invalid. Ask the issuer to resend it.' }
  })
  const [pendingToken, setPendingToken] = useState(initialLink.token)
  const [sessionToken, setSessionToken] = useState('')
  const [credential, setCredential] = useState<RecipientManagedCredential | null>(null)
  const [visibility, setVisibility] = useState<'public' | 'unlisted'>('unlisted')
  const [maskedNameConsent, setMaskedNameConsent] = useState(false)
  const [fullNameConsent, setFullNameConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(initialLink.error)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (window.location.hash) {
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`)
    }
  }, [])

  async function redeemLink() {
    if (!supabase || !pendingToken) return
    setBusy(true)
    setError('')
    try {
      const { data, error: invokeError } = await supabase.functions.invoke<{
        sessionToken: string
        credential: RecipientManagedCredential
      }>('manage-recipient-credential', {
        body: { action: 'redeem', token: pendingToken },
      })
      if (invokeError) throw invokeError
      if (!data?.sessionToken || !data.credential?.credentialId) {
        throw new Error('The management link returned an invalid response.')
      }
      setSessionToken(data.sessionToken)
      setCredential(data.credential)
      setVisibility(data.credential.visibility)
      setMaskedNameConsent(data.credential.maskedNameConsent)
      setFullNameConsent(data.credential.fullNameConsent)
      setPendingToken('')
    } catch (cause) {
      setError(requestErrorMessage(cause, copyId.errors.managementLinkInvalid))
    } finally {
      setBusy(false)
    }
  }

  async function saveVisibility(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !sessionToken || !credential) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const { data, error: invokeError } = await supabase.functions.invoke<{
        credentialId: string
        serialNumber: string
        visibility: 'public' | 'unlisted'
      }>('manage-recipient-credential', {
        body: { action: 'set-visibility', sessionToken, visibility },
      })
      if (invokeError) throw invokeError
      if (!data || data.credentialId !== credential.credentialId) {
        throw new Error('The management service returned an invalid response.')
      }
      setCredential({ ...credential, visibility: data.visibility })
      setMessage(`Visibility updated to ${data.visibility}.`)
    } catch (cause) {
      setError(requestErrorMessage(cause, copyId.errors.managementUpdateFailed))
    } finally {
      setBusy(false)
    }
  }

  async function saveNameConsent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !sessionToken || !credential) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const { data, error: invokeError } = await supabase.functions.invoke<{
        credentialId: string
        maskedNameConsent: boolean
        fullNameConsent: boolean
      }>('manage-recipient-credential', {
        body: {
          action: 'set-name-consent',
          sessionToken,
          maskedNameConsent,
          fullNameConsent,
        },
      })
      if (invokeError) throw invokeError
      if (!data || data.credentialId !== credential.credentialId) {
        throw new Error('The management service returned an invalid consent response.')
      }
      setCredential({
        ...credential,
        maskedNameConsent: data.maskedNameConsent,
        fullNameConsent: data.fullNameConsent,
      })
      setMaskedNameConsent(data.maskedNameConsent)
      setFullNameConsent(data.fullNameConsent)
      setMessage('Name-display consent updated.')
    } catch (cause) {
      setError(requestErrorMessage(cause, copyId.errors.managementUpdateFailed))
    } finally {
      setBusy(false)
    }
  }

  return (
    <PortalLayout>
      <section className="admin-login">
        <span className="eyebrow">RECIPIENT ACCESS</span>
        <h1>Manage your credential</h1>
        <p>This short-lived link lets you change visibility for one credential. It expires after use or 30 minutes.</p>
        {error && <p className="admin-error" role="alert">{error}</p>}
        {!supabase && <p className="admin-error" role="alert">Recipient management is not configured.</p>}
        {pendingToken && (
          <div className="admin-card admin-form">
            <p>Continue only if you requested this link. Opening it consumes the one-time link and starts a 15-minute management session.</p>
            <button className="button button-primary" disabled={busy || !supabase} onClick={() => void redeemLink()}>
              {busy ? 'Opening…' : 'Open secure link'}
            </button>
          </div>
        )}
        {credential && (
          <div className="admin-card">
            <span className="eyebrow">YOUR CREDENTIAL</span>
            <h2>{credential.achievementName || 'Digital credential'}</h2>
            <p>Serial number: <code>{credential.serialNumber}</code></p>
            <p><Link to={`/c/${credential.credentialId}`}>View credential</Link></p>
            <form className="admin-form" onSubmit={(event) => void saveVisibility(event)}>
              <label htmlFor="recipient-visibility">Visibility</label>
              <select
                id="recipient-visibility"
                value={visibility}
                disabled={busy}
                onChange={(event) => setVisibility(event.target.value as 'public' | 'unlisted')}
              >
                <option value="unlisted">Unlisted — accessible by link or QR</option>
                <option value="public">Public — may appear in public listings</option>
              </select>
              <p>Name display is hidden unless you choose otherwise below. Anyone with the credential link or QR may see a name you consent to display. Withdrawal cannot remove screenshots or copies retained by third-party services.</p>
              {message && <p role="status">{message}</p>}
              <button className="button button-primary" disabled={busy || visibility === credential.visibility}>
                {busy ? 'Saving…' : 'Save visibility'}
              </button>
            </form>
            <form className="admin-form" onSubmit={(event) => void saveNameConsent(event)}>
              <label className="consent-option">
                <input
                  type="checkbox"
                  checked={maskedNameConsent}
                  disabled={busy}
                  onChange={(event) => setMaskedNameConsent(event.target.checked)}
                />
                Allow a masked name on the public credential page
              </label>
              <p>For longer names, the first word is shown and later words are reduced to an initial plus three stars (for example, “Ahmad R*** S***”). Single-word or very short names are shown as initials only.</p>
              <label className="consent-option">
                <input
                  type="checkbox"
                  checked={fullNameConsent}
                  disabled={busy}
                  onChange={(event) => setFullNameConsent(event.target.checked)}
                />
                Separately allow my full name on the public credential page
              </label>
              <button
                className="button button-secondary"
                disabled={busy || (
                  maskedNameConsent === credential.maskedNameConsent
                  && fullNameConsent === credential.fullNameConsent
                )}
              >
                {busy ? 'Saving…' : 'Save name-display choices'}
              </button>
            </form>
          </div>
        )}
      </section>
    </PortalLayout>
  )
}

function RoutedPortal() {
  return (
    <Routes>
      {StyleguidePage && (
        <Route
          path="/_styleguide"
          element={
            <Suspense fallback={<div role="status">{copyId.common.loading}…</div>}>
              <StyleguidePage />
            </Suspense>
          }
        />
      )}
      <Route path="/" element={<HomePage />} />
      <Route path="/admin" element={<AdminRoute />} />
      <Route path="/invite" element={<OrganizationInvitationPage />} />
      <Route path="/verify/:id" element={<VerifyRoute />} />
      <Route path="/c/:id" element={<CredentialPage />} />
      <Route path="/manage" element={<RecipientManagementPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}

export default function App() {
  return <BrowserRouter><RoutedPortal /></BrowserRouter>
}
