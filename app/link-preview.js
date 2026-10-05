import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const decodeEntities = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

const clean = (s) => decodeEntities(String(s || '').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()

function metaContent(html, key) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const name = /\b(?:property|name)\s*=\s*["']([^"']*)["']/i.exec(tag)
    if (!name || name[1].toLowerCase() !== key) continue
    const content = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag)
    if (content) return clean(content[1] ?? content[2])
  }
  return ''
}

function jsonLdArtist(html) {
  const pattern = /<script\b[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi
  let match
  while ((match = pattern.exec(html))) {
    try {
      const data = JSON.parse(match[1])
      const items = Array.isArray(data) ? data : [data]
      for (const item of items) {
        const by = item && (item.byArtist || item.author)
        const list = Array.isArray(by) ? by : by ? [by] : []
        const names = list.map((a) => clean(typeof a === 'string' ? a : a.name)).filter(Boolean)
        if (names.length) return names.join(', ')
      }
    } catch {}
  }
  return ''
}

export function parsePreview(html, host = '') {
  const ogTitle = metaContent(html, 'og:title')
  const ogDescription = metaContent(html, 'og:description')
  let artist = jsonLdArtist(html)
  if (!artist && host === 'open.spotify.com' && ogDescription.includes(' · ')) artist = ogDescription.split(' · ')[0].trim()
  if (ogTitle) return { title: ogTitle, artist }
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)
  return { title: clean(titleTag && titleTag[1]) || clean(h1 && h1[1]), artist }
}

export function isPrivateAddress(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
  }
  const v6 = ip.toLowerCase()
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7))
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6)
}

async function assertPublicHost(hostname) {
  const bare = hostname.replace(/^\[|\]$/g, '')
  const addresses = isIP(bare) ? [{ address: bare }] : await lookup(bare, { all: true })
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) throw new Error('private address')
}

export async function fetchPreview(rawUrl, { timeoutMs = 5000, maxBytes = 1048576, maxRedirects = 3 } = {}) {
  let url = new URL(rawUrl)
  const signal = AbortSignal.timeout(timeoutMs)
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('bad protocol')
    await assertPublicHost(url.hostname)
    const res = await fetch(url, { redirect: 'manual', signal, headers: { 'user-agent': 'Mozilla/5.0 (compatible; set-brainz)', accept: 'text/html' } })
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location'), url)
      continue
    }
    if (!res.ok) throw new Error(`status ${res.status}`)
    const reader = res.body.getReader()
    const chunks = []
    let size = 0
    while (size < maxBytes) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      size += value.length
    }
    await reader.cancel().catch(() => {})
    return parsePreview(Buffer.concat(chunks).toString('utf8'), url.hostname)
  }
  throw new Error('too many redirects')
}
