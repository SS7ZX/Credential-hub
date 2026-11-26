import { describe, expect, it } from 'vitest'
import { validatePublicSiteConfig } from './predeploy-check.mjs'

describe('pre-deploy site configuration check', () => {
  it('derives a DID whose host matches a valid HTTPS origin', () => {
    expect(validatePublicSiteConfig('https://issuer.school.org/')).toEqual({
      siteUrl: 'https://issuer.school.org',
      did: 'did:web:issuer.school.org',
    })
  })

  it.each([
    undefined,
    '',
    'https://example.test',
    'https://issuer.invalid',
    'https://canary.issuer.org',
    'https://issuer.example.com',
    'https://invalid',
  ])('rejects unset and placeholder host values: %s', (value) => {
    expect(() => validatePublicSiteConfig(value)).toThrow()
  })

  it('requires HTTPS for public origins', () => {
    expect(() => validatePublicSiteConfig('http://issuer.school.org')).toThrow(/HTTPS/)
  })

  it('allows HTTP localhost only in development mode', () => {
    expect(validatePublicSiteConfig('http://localhost:5173', { allowLocalhost: true }).did)
      .toBe('did:web:localhost%3A5173')
    expect(() => validatePublicSiteConfig('http://localhost:5173')).toThrow(/development/)
  })

  it('rejects a derived DID that does not match the configured host', () => {
    expect(() => validatePublicSiteConfig('https://issuer.school.org', {
      deriveIssuerDid: () => 'did:web:other.example.org',
    })).toThrow(/does not match/)
  })
})
