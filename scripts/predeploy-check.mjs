import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function isLocalhost(hostname) {
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname.toLowerCase())
}

function deriveDid(url) {
  const port = url.port ? `%3A${url.port}` : ''
  return `did:web:${url.hostname.toLowerCase()}${port}`
}

export function validatePublicSiteConfig(
  value,
  { allowLocalhost = process.env.NODE_ENV === 'development', deriveIssuerDid = deriveDid } = {},
) {
  if (!value?.trim()) {
    throw new Error('PUBLIC_SITE_URL is not set')
  }

  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('PUBLIC_SITE_URL must be an absolute URL')
  }

  const hostname = url.hostname.toLowerCase()
  const local = isLocalhost(hostname)
  const reservedHost = hostname.endsWith('.test')
    || hostname.endsWith('.invalid')
    || hostname.endsWith('.example')
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || ['example.com', 'example.net', 'example.org'].some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    )
  const canaryHost = /(^|[.-])canary([.-]|$)/i.test(hostname)

  if (
    url.username
    || url.password
    || (url.pathname !== '/' && url.pathname !== '')
    || url.search
    || url.hash
  ) {
    throw new Error('PUBLIC_SITE_URL must contain only the site origin')
  }
  if (local && !allowLocalhost) {
    throw new Error('localhost is allowed only for development')
  }
  if (!local && (!hostname.includes('.') || hostname.endsWith('.'))) {
    throw new Error('PUBLIC_SITE_URL must use a fully qualified public host')
  }
  if (!local && (reservedHost || canaryHost)) {
    throw new Error('PUBLIC_SITE_URL must use a deployable, non-placeholder host')
  }
  if (url.protocol !== 'https:' && !(local && allowLocalhost && url.protocol === 'http:')) {
    throw new Error('PUBLIC_SITE_URL must use HTTPS (HTTP is allowed only for localhost development)')
  }

  const expectedDid = deriveDid(url)
  const derivedDid = deriveIssuerDid(url)
  if (derivedDid.toLowerCase() !== expectedDid.toLowerCase()) {
    throw new Error('Derived issuer DID does not match the PUBLIC_SITE_URL host')
  }

  return { siteUrl: url.origin, did: derivedDid }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const config = validatePublicSiteConfig(process.env.PUBLIC_SITE_URL)
    console.log(`Pre-deploy site configuration passed for ${config.siteUrl}`)
    console.log(`Derived issuer DID: ${config.did}`)
  } catch (error) {
    console.error(`Pre-deploy site configuration failed: ${error.message}`)
    process.exitCode = 1
  }
}
