import { afterEach, describe, expect, it, vi } from 'vitest'
import middleware from '../middleware'

const requestUrl = 'https://tasdiqapp.com/c/123e4567-e89b-12d3-a456-426614174000'
const appHtml = '<html><head><title>Tasdiq</title><meta name="description" content="Default"></head><body></body></html>'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('credential metadata middleware', () => {
  it('only adds crawler metadata from the public credential projection', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-anon-key')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(appHtml))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        credential: {
          issuer: { name: 'Tasdiq & Co' },
          credentialSubject: {
            name: 'Ahmad R*** S***',
            identifier: {
              identityHash: 'private-hash',
              salt: 'private-salt',
            },
            achievement: {
              name: '<Gold Award>',
              description: 'Achievement & impact',
              image: 'https://assets.example.test/badge.png',
            },
          },
        },
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await middleware(new Request(requestUrl, {
      headers: { 'user-agent': 'Twitterbot' },
    }))
    const html = await response.text()

    expect(response.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=30')
    expect(html).toContain('&lt;Gold Award&gt; | Tasdiq &amp; Co')
    expect(html).toContain('Achievement &amp; impact · Awarded to Ahmad R*** S***')
    expect(html).toContain('https://assets.example.test/badge.png')
    expect(html).not.toContain('private-hash')
    expect(html).not.toContain('private-salt')
  })

  it('does not add recipient metadata when consent is absent from the public projection', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-anon-key')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(appHtml))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        credential: {
          credentialSubject: {
            achievement: { name: 'Participation Award' },
          },
        },
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await middleware(new Request(requestUrl, {
      headers: { 'user-agent': 'Twitterbot' },
    }))
    const html = await response.text()

    expect(html).toContain('Participation Award')
    expect(html).not.toContain('Awarded to')
  })

  it('does not request credential metadata for regular visitors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(appHtml))
    vi.stubGlobal('fetch', fetchMock)

    const response = await middleware(new Request(requestUrl, {
      headers: { 'user-agent': 'Mozilla/5.0' },
    }))

    expect(await response.text()).toBe(appHtml)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(response.headers.get('cache-control')).toBeNull()
  })
})
