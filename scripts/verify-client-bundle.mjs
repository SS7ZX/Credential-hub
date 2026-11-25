import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = 'dist'
const secretNames = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'ISSUER_OWNER_EMAIL',
  'OPENAI_API_KEY',
  'RESEND_API_KEY',
  'RESEND_FROM_EMAIL',
  'RESEND_DAILY_PLAN_LIMIT',
  'RESEND_SANDBOX',
  'RESEND_SANDBOX_TO',
  'SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN',
  'SUPABASE_AUTH_EXTERNAL_APPLE_SECRET',
  'S3_HOST',
  'S3_REGION',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'SENDGRID_API_KEY',
  'PUBLIC_SITE_URL',
  'RATE_LIMIT_HASH_SECRET',
  'CREDENTIAL_SIGNING_KID',
  'CREDENTIAL_SIGNING_ALGORITHM',
  'CREDENTIAL_SIGNING_KEY_PKCS8',
  'CREDENTIAL_SIGNING_PUBLIC_KEY_SPKI',
  'ORGANIZATION_DID',
]
const forbiddenValues = secretNames
  .map((name) => [name, process.env[name]])
  .filter((entry) => typeof entry[1] === 'string' && entry[1].length >= 12)
const forbiddenMarkers = [
  '-----BEGIN PRIVATE KEY-----',
  '-----BEGIN RSA PRIVATE KEY-----',
  '-----BEGIN EC PRIVATE KEY-----',
  '-----BEGIN OPENSSH PRIVATE KEY-----',
]

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? filesUnder(path) : [path]
  })
}

let files
try {
  files = filesUnder(root)
} catch {
  console.error('Build output is missing; run npm run build first.')
  process.exit(1)
}

const leaks = new Set()
for (const path of files) {
  const contents = readFileSync(path)
  for (const [name, value] of forbiddenValues) {
    if (contents.includes(Buffer.from(value))) leaks.add(name)
  }
  const text = contents.toString('utf8')
  for (const marker of forbiddenMarkers) {
    if (text.includes(marker)) leaks.add(marker)
  }
  for (const name of secretNames) {
    if (text.includes(name)) leaks.add(`${name} (environment variable name)`)
  }
}

if (leaks.size) {
  console.error(`Potential server-side configuration in dist: ${[...leaks].join(', ')}`)
  process.exit(1)
}
console.log(`Client bundle check passed (${files.length} built files).`)
