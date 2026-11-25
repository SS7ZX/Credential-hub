import { Ajv2019 } from 'ajv/dist/2019.js'
import addFormats from 'ajv-formats'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const required = [
  'STAGING_SUPABASE_URL',
  'STAGING_SUPABASE_ANON_KEY',
  'STAGING_PROJECT_REF',
  'STAGING_CREDENTIAL_ID',
  'STAGING_ACKNOWLEDGEMENT',
]
const missing = required.filter((name) => !process.env[name])
if (missing.length) {
  console.error(`Missing required staging settings: ${missing.join(', ')}`)
  process.exit(1)
}

if (process.env.STAGING_ACKNOWLEDGEMENT !== 'I_CONFIRM_THIS_IS_STAGING') {
  console.error('Set STAGING_ACKNOWLEDGEMENT=I_CONFIRM_THIS_IS_STAGING after checking the project.')
  process.exit(1)
}

const projectRef = process.env.STAGING_PROJECT_REF
const baseUrl = new URL(process.env.STAGING_SUPABASE_URL)
const localHosts = new Set(['localhost', '127.0.0.1'])
const isLocal = localHosts.has(baseUrl.hostname)
if (
  (baseUrl.protocol !== 'https:' && !(isLocal && baseUrl.protocol === 'http:')) ||
  (!isLocal && baseUrl.hostname !== `${projectRef}.supabase.co`) ||
  (isLocal && projectRef !== 'local')
) {
  console.error('Staging URL does not match STAGING_PROJECT_REF; refusing to fetch.')
  process.exit(1)
}

const credentialId = process.env.STAGING_CREDENTIAL_ID
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(credentialId)) {
  console.error('STAGING_CREDENTIAL_ID must be a UUID.')
  process.exit(1)
}

const endpoint = `${baseUrl.href.replace(/\/$/, '')}/functions/v1/get-credential`
const response = await fetch(endpoint, {
  method: 'POST',
  headers: {
    apikey: process.env.STAGING_SUPABASE_ANON_KEY,
    authorization: `Bearer ${process.env.STAGING_SUPABASE_ANON_KEY}`,
    'content-type': 'application/json',
    accept: 'application/vc+jwt',
  },
  body: JSON.stringify({ id: credentialId, format: 'jwt' }),
})
if (!response.ok) {
  console.error(`Staging credential download failed with HTTP ${response.status}.`)
  process.exit(1)
}

const compactJwt = (await response.text()).trim()
const jwtParts = compactJwt.split('.')
if (jwtParts.length !== 3) {
  console.error('Credential endpoint did not return a compact VC-JWT.')
  process.exit(1)
}

let header
let credential
try {
  header = JSON.parse(Buffer.from(jwtParts[0], 'base64url').toString('utf8'))
  credential = JSON.parse(Buffer.from(jwtParts[1], 'base64url').toString('utf8'))
} catch {
  console.error('Credential JWT header or payload is not valid JSON.')
  process.exit(1)
}
if (header.typ !== 'vc+jwt' || header.cty !== 'vc') {
  console.error('Credential does not use the expected VC-JWT typ/cty header.')
  process.exit(1)
}
if (typeof credential.id !== 'string' || !credential.id.endsWith(`/credentials/${credentialId}`)) {
  console.error('The downloaded credential ID does not match STAGING_CREDENTIAL_ID.')
  process.exit(1)
}

const schemaPath = fileURLToPath(
  new URL('../supabase/functions/_shared/ob_v3p0_achievementcredential_schema.json', import.meta.url),
)
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'))
const ajv = new Ajv2019({ allErrors: true, strict: false })
addFormats(ajv)
const validate = ajv.compile(schema)
if (!validate(credential)) {
  const issues = (validate.errors ?? [])
    .map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`)
    .join('\n')
  console.error(`Credential failed the pinned Open Badges 3.0 JSON Schema:\n${issues}`)
  process.exit(1)
}

console.log(`Schema valid: staging credential ${credentialId}`)
