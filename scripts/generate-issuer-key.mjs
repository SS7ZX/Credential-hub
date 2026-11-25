import { generateKeyPairSync } from 'node:crypto'

const [kid] = process.argv.slice(2)
if (!kid || !/^[A-Za-z0-9._-]{1,128}$/.test(kid)) {
  console.error('Usage: npm run keygen -- <kid>')
  process.exitCode = 1
} else {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const privatePkcs8 = privateKey.export({ type: 'pkcs8', format: 'pem' })
  const publicSpki = publicKey.export({ type: 'spki', format: 'pem' })
  const publicJwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'EdDSA', use: 'sig' }

  console.log('Copy the private value directly into Supabase Secrets. Do not commit or log it.')
  console.log(`CREDENTIAL_SIGNING_KEY_PKCS8=${JSON.stringify(privatePkcs8.toString())}`)
  console.log(`CREDENTIAL_SIGNING_PUBLIC_KEY_SPKI=${JSON.stringify(publicSpki.toString())}`)
  console.log(`CREDENTIAL_SIGNING_KID=${kid}`)
  console.log('CREDENTIAL_SIGNING_ALGORITHM=EdDSA')
  console.log(`Public JWK for issuer_keys.public_jwk: ${JSON.stringify(publicJwk)}`)
}
