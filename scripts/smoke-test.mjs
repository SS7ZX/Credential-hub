#!/usr/bin/env node

import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const REQUIRED_SECURITY_HEADERS = [
  'content-security-policy',
  'permissions-policy',
  'referrer-policy',
  'strict-transport-security',
  'x-content-type-options',
  'x-frame-options',
]
const CREDENTIAL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function localUrl(value, label) {
  const url = new URL(value)
  assert(
    ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname),
    `${label} must use a loopback host; this H2 smoke runner is local-only`,
  )
  return url
}

function parseArguments(argv) {
  const [baseUrl, ...args] = argv
  if (!baseUrl || baseUrl === '--help') {
    return { help: true }
  }

  const options = {
    credentialId: process.env.SMOKE_TEST_CREDENTIAL_ID,
    supabaseUrl: process.env.SMOKE_SUPABASE_URL,
    anonKey: process.env.SMOKE_SUPABASE_ANON_KEY,
    rateLimitAttempts: Number(process.env.SMOKE_RATE_LIMIT_ATTEMPTS ?? 75),
  }
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index]
    const value = args[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${option}`)
    if (option === '--credential-id') options.credentialId = value
    else if (option === '--supabase-url') options.supabaseUrl = value
    else if (option === '--anon-key') options.anonKey = value
    else if (option === '--rate-limit-attempts') options.rateLimitAttempts = Number(value)
    else throw new Error(`Unknown option: ${option}`)
    index += 1
  }
  return { baseUrl, ...options }
}

function checkSecurityHeaders(response, label) {
  for (const header of REQUIRED_SECURITY_HEADERS) {
    assert(response.headers.has(header), `${label} is missing ${header}`)
  }
  const csp = response.headers.get('content-security-policy') ?? ''
  assert(csp.includes("frame-ancestors 'none'"), `${label} CSP does not block framing`)
  assert(
    (response.headers.get('permissions-policy') ?? '').includes('camera=(self)'),
    `${label} does not restrict camera access to this origin`,
  )
}

function parseMeta(html, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = html.match(new RegExp(`<meta\\s+[^>]*(?:property|name)=["']${escaped}["'][^>]*>`, 'i'))
  return match?.[0] ?? ''
}

function keyProjection(didDocument) {
  return new Map(
    (didDocument.verificationMethod ?? []).map((method) => [
      method.publicKeyJwk?.kid,
      JSON.stringify(method.publicKeyJwk),
    ]),
  )
}

export async function runSmoke({
  baseUrl,
  supabaseUrl,
  anonKey,
  credentialId,
  rateLimitAttempts = 75,
  fetchImpl = fetch,
}) {
  const site = localUrl(baseUrl, 'Base URL')
  const functions = localUrl(supabaseUrl, 'Supabase URL')
  assert(Number.isInteger(rateLimitAttempts) && rateLimitAttempts > 0, 'Rate-limit attempts must be a positive integer')
  assert(CREDENTIAL_ID_PATTERN.test(credentialId ?? ''), 'A known test credential UUID is required')
  assert(typeof anonKey === 'string' && anonKey.length > 0, 'A local Supabase anon/publishable key is required')

  const results = []
  async function record(name, operation) {
    await operation()
    results.push({ check: name, result: 'PASS' })
  }

  const homeResponse = await fetchImpl(new URL('/', site), {
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  })
  assert(homeResponse.status === 200, `Home page returned HTTP ${homeResponse.status}`)
  checkSecurityHeaders(homeResponse, 'Home page')
  results.push({ check: 'home and security headers', result: 'PASS' })

  let didDocument
  await record('DID document', async () => {
    const response = await fetchImpl(new URL('/.well-known/did.json', site), {
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    })
    assert(response.status === 200, `DID document returned HTTP ${response.status}`)
    didDocument = await response.json()
    assert(typeof didDocument.id === 'string', 'DID document has no id')
  })

  await record('JWKS and DID key agreement', async () => {
    const response = await fetchImpl(new URL('/.well-known/jwks.json', site), {
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    })
    assert(response.status === 200, `JWKS returned HTTP ${response.status}`)
    const jwks = await response.json()
    const didKeys = keyProjection(didDocument)
    const jwksKeys = new Map((jwks.keys ?? []).map((key) => [key.kid, JSON.stringify(key)]))
    assert(didKeys.size > 0, 'DID document publishes no verification keys')
    assert(didKeys.size === jwksKeys.size, 'DID and JWKS key counts differ')
    for (const [kid, jwk] of didKeys) {
      assert(jwksKeys.get(kid) === jwk, `DID and JWKS key mismatch for kid ${kid}`)
    }
  })

  await record('credential verification', async () => {
    const response = await fetchImpl(new URL('/functions/v1/verify-credential', functions), {
      method: 'POST',
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${anonKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ id: credentialId }),
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    })
    assert(response.status === 200, `Known credential verification returned HTTP ${response.status}`)
    const verification = await response.json()
    assert(verification.valid === true, `Known credential did not verify: ${verification.summary ?? 'invalid'}`)
  })

  await record('credential Open Graph metadata', async () => {
    const response = await fetchImpl(new URL(`/c/${credentialId}`, site), {
      headers: { 'user-agent': 'Twitterbot' },
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    })
    assert(response.status === 200, `Credential share page returned HTTP ${response.status}`)
    checkSecurityHeaders(response, 'Credential share page')
    const html = await response.text()
    for (const tag of ['og:title', 'og:description', 'twitter:title']) {
      assert(parseMeta(html, tag), `Credential share page has no ${tag} metadata`)
    }
  })

  await record('unknown credential 404', async () => {
    const unknownId = randomUUID()
    const response = await fetchImpl(new URL('/functions/v1/verify-credential', functions), {
      method: 'POST',
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${anonKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ id: unknownId }),
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    })
    assert(response.status === 404, `Unknown credential returned HTTP ${response.status}, expected 404`)
    const body = await response.json()
    assert(body.error === 'Credential not found', 'Unknown credential response was not the expected 404')
  })

  await record('public verification rate limit', async () => {
    let sawRateLimit = false
    for (let attempt = 0; attempt < rateLimitAttempts; attempt += 1) {
      const response = await fetchImpl(new URL('/functions/v1/verify-credential', functions), {
        method: 'POST',
        headers: {
          apikey: anonKey,
          authorization: `Bearer ${anonKey}`,
          'content-type': 'application/json',
          'x-forwarded-for': '127.0.0.1',
        },
        body: JSON.stringify({ id: credentialId }),
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      })
      if (response.status === 429) {
        sawRateLimit = true
        break
      }
      assert(response.status === 200, `Rate-limit probe returned unexpected HTTP ${response.status}`)
    }
    assert(sawRateLimit, `No HTTP 429 within ${rateLimitAttempts} requests`)
  })

  return {
    result: 'PASS',
    target: site.origin,
    note: 'Business data is read-only; the rate-limit probe consumes local rate-limit counters.',
    checks: results,
  }
}

function usage() {
  return [
    'Usage: node scripts/smoke-test.mjs <local-base-url> --credential-id <uuid> --supabase-url <local-url> --anon-key <key> [--rate-limit-attempts 75]',
    'Equivalent process variables: SMOKE_TEST_CREDENTIAL_ID, SMOKE_SUPABASE_URL, SMOKE_SUPABASE_ANON_KEY, SMOKE_RATE_LIMIT_ATTEMPTS.',
    'This runner rejects non-loopback hosts and does not load dotenv files.',
  ].join('\n')
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) {
    console.log(usage())
    return
  }
  console.log(JSON.stringify(await runSmoke(options), null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`H2 smoke test failed: ${error.message}`)
    process.exitCode = 1
  })
}
