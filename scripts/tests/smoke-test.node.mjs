import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { after, before, test } from 'node:test'
import { runSmoke } from '../smoke-test.mjs'

const credentialId = '123e4567-e89b-42d3-a456-426614174000'
const jwk = { kty: 'OKP', crv: 'Ed25519', x: 'synthetic-public-key', kid: 'h2-test-key', alg: 'EdDSA' }
const didDocument = {
  id: 'did:web:127.0.0.1',
  verificationMethod: [{ id: 'did:web:127.0.0.1#h2-test-key', publicKeyJwk: jwk }],
}
const html = [
  '<html><head><title>H2 fixture</title>',
  '<meta name="description" content="H2 fixture">',
  '<meta property="og:title" content="H2 fixture">',
  '<meta property="og:description" content="H2 fixture">',
  '<meta name="twitter:title" content="H2 fixture">',
  '</head><body></body></html>',
].join('')
let server
let baseUrl
let rateRequests = 0

function setSecurityHeaders(response) {
  response.setHeader('content-security-policy', "default-src 'self'; frame-ancestors 'none'")
  response.setHeader('permissions-policy', 'camera=(self), microphone=()')
  response.setHeader('referrer-policy', 'strict-origin-when-cross-origin')
  response.setHeader('strict-transport-security', 'max-age=31536000')
  response.setHeader('x-content-type-options', 'nosniff')
  response.setHeader('x-frame-options', 'DENY')
}

before(async () => {
  server = createServer(async (request, response) => {
    setSecurityHeaders(response)
    if (request.method === 'GET' && request.url === '/.well-known/did.json') {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify(didDocument))
      return
    }
    if (request.method === 'GET' && request.url === '/.well-known/jwks.json') {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ keys: [jwk] }))
      return
    }
    if (request.method === 'GET' && request.url === '/') {
      response.setHeader('content-type', 'text/html')
      response.end(html)
      return
    }
    if (request.method === 'GET' && request.url === `/c/${credentialId}`) {
      response.setHeader('content-type', 'text/html')
      response.end(html)
      return
    }
    if (request.method === 'POST' && request.url === '/functions/v1/verify-credential') {
      let rawBody = ''
      for await (const chunk of request) rawBody += chunk
      const { id } = JSON.parse(rawBody)
      rateRequests += 1
      if (rateRequests >= 4) {
        response.writeHead(429, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: 'Too many requests' }))
      } else if (id === credentialId) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ valid: true, summary: 'Credential is valid' }))
      } else {
        response.writeHead(404, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: 'Credential not found' }))
      }
      return
    }
    response.writeHead(404)
    response.end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
})

test('smoke runner checks discovery, verification, OG, security, 404, and 429 locally', async () => {
  rateRequests = 0
  const result = await runSmoke({
    baseUrl,
    supabaseUrl: baseUrl,
    anonKey: 'local-public-test-key',
    credentialId,
    rateLimitAttempts: 6,
  })
  assert.equal(result.result, 'PASS')
  assert.equal(result.checks.length, 7)
  assert.equal(result.checks.at(-1).check, 'public verification rate limit')
})

test('smoke runner refuses hosted targets', async () => {
  await assert.rejects(runSmoke({
    baseUrl: 'https://example.test',
    supabaseUrl: 'http://127.0.0.1:54321',
    anonKey: 'local-public-test-key',
    credentialId,
  }), /loopback host/)
})
