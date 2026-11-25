import { createPrivateKey, createPublicKey } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

function generate(kid: string) {
  return spawnSync(process.execPath, ['scripts/generate-issuer-key.mjs', kid], {
    encoding: 'utf8',
    cwd: process.cwd(),
  })
}

describe('issuer key generation', () => {
  it('creates a matching Ed25519 key pair and a public signing JWK', () => {
    const result = generate('unit-test-key')
    expect(result.status).toBe(0)
    const privatePem = JSON.parse(result.stdout.match(/CREDENTIAL_SIGNING_KEY_PKCS8=(.+)/)?.[1] ?? '""') as string
    const publicPem = JSON.parse(result.stdout.match(/CREDENTIAL_SIGNING_PUBLIC_KEY_SPKI=(.+)/)?.[1] ?? '""') as string
    const jwkOutput = result.stdout.match(/Public JWK for issuer_keys\.public_jwk: (.+)/)?.[1]
    expect(jwkOutput).toBeDefined()
    const derivedPublic = createPublicKey(createPrivateKey(privatePem)).export({ type: 'spki', format: 'pem' })
    expect(derivedPublic).toBe(publicPem)
    expect(JSON.parse(jwkOutput!)).toMatchObject({ kid: 'unit-test-key', alg: 'EdDSA', use: 'sig', kty: 'OKP', crv: 'Ed25519' })
  })

  it('rejects missing or unsafe key identifiers', () => {
    expect(generate('invalid key').status).toBe(1)
  })
})
