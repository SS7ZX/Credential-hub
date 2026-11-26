const fallbackTitle = 'Digital credential | Credential Hub'
const fallbackDescription = 'A shareable Open Badges 3.0 digital credential.'

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]!)
}

function isCrawler(userAgent: string): boolean {
  return /facebookexternalhit|facebot|twitterbot|linkedinbot|slackbot|telegrambot|whatsapp|discordbot|googlebot|bingbot/i.test(userAgent)
}

async function getPublicMetadata(id: string): Promise<{ title: string; description: string; image?: string }> {
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) return { title: fallbackTitle, description: fallbackDescription }

  try {
    const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/functions/v1/get-credential`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${anonKey}`,
        'content-type': 'application/json',
        'cache-control': 'no-cache',
      },
      cache: 'no-store',
      body: JSON.stringify({ id, format: 'json' }),
    })
    if (!response.ok) return { title: fallbackTitle, description: fallbackDescription }

    const result = await response.json() as {
      credential?: {
        issuer?: string | { name?: string }
        credentialSubject?: {
          name?: string
          achievement?: { name?: string; description?: string; image?: string }
        }
      }
    }
    const achievement = result.credential?.credentialSubject?.achievement
    if (!achievement?.name) return { title: fallbackTitle, description: fallbackDescription }

    const recipientName = result.credential?.credentialSubject?.name
    const issuer = typeof result.credential?.issuer === 'string'
      ? result.credential.issuer
      : result.credential?.issuer?.name
    const image = typeof achievement.image === 'string' && achievement.image.startsWith('https://')
      ? achievement.image
      : undefined
    return {
      title: (issuer ? `${achievement.name} | ${issuer}` : achievement.name).slice(0, 180),
      description: [
        achievement.description ?? fallbackDescription,
        ...(recipientName ? [`Awarded to ${recipientName}`] : []),
      ].join(' · ').slice(0, 300),
      ...(image ? { image } : {}),
    }
  } catch (error) {
    console.error('Unable to build public credential metadata', error)
    return { title: fallbackTitle, description: fallbackDescription }
  }
}

export const config = {
  matcher: ['/c/:id'],
  runtime: 'nodejs',
}

export default async function middleware(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const id = url.pathname.match(/^\/c\/([0-9a-f-]{36})$/i)?.[1]
  const appResponse = await fetch(new URL('/index.html', request.url))
  if (!appResponse.ok) return new Response('Credential page is unavailable.', { status: 503 })
  if (!id || !isCrawler(request.headers.get('user-agent') ?? '')) return appResponse

  const metadata = await getPublicMetadata(id)
  let html = await appResponse.text()
  const title = escapeHtml(metadata.title)
  const description = escapeHtml(metadata.description)
  const tags = [
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${description}">`,
    `<meta name="twitter:card" content="summary${metadata.image ? '_large_image' : ''}">`,
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${description}">`,
    ...(metadata.image ? [`<meta property="og:image" content="${escapeHtml(metadata.image)}">`] : []),
    ...(metadata.image ? [`<meta name="twitter:image" content="${escapeHtml(metadata.image)}">`] : []),
  ].join('')
  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${title}</title>`)
  html = html.replace(
    /<meta name="description" content="[^"]*"\s*\/?>/i,
    `<meta name="description" content="${description}">`,
  )
  html = html.replace('</head>', `${tags}</head>`)

  const headers = new Headers(appResponse.headers)
  headers.set('content-type', 'text/html; charset=utf-8')
  headers.set('cache-control', 'public, max-age=0, s-maxage=30')
  return new Response(html, { status: appResponse.status, headers })
}
