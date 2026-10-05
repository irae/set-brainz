import { test } from 'tap'
import { once } from 'node:events'
import { makeEmptyDataDir } from './helpers/fixtures.js'
import { createApp } from '../app/server.js'
import { parsePreview, isPrivateAddress, fetchPreview } from '../app/link-preview.js'

test('parses a Spotify page with JSON-LD artist', async (t) => {
  const html = `<html><head><meta property="og:title" content="Fixture &amp; Title"><script type="application/ld+json">{"byArtist":[{"name":"Fixture Artist"}]}</script></head></html>`
  t.same(parsePreview(html, 'open.spotify.com'), { title: 'Fixture & Title', artist: 'Fixture Artist' })
})

test('takes the Spotify artist from the description when JSON-LD is missing', async (t) => {
  const html = `<meta property="og:title" content="TESTVIDEO01 Song"><meta property="og:description" content="Fixture Artist · Song · 2020">`
  t.same(parsePreview(html, 'open.spotify.com'), { title: 'TESTVIDEO01 Song', artist: 'Fixture Artist' })
})

test('falls back to the title tag, then to the first h1', async (t) => {
  t.same(parsePreview('<title> Plain  page </title><h1>Head</h1>'), { title: 'Plain page', artist: '' })
  t.same(parsePreview('<title> </title><h1>Head <b>one</b></h1>'), { title: 'Head one', artist: '' })
  t.same(parsePreview('<p>nothing</p>'), { title: '', artist: '' })
})

test('flags private and local addresses', async (t) => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.5', '172.16.0.1', '169.254.1.1', '::1', 'fd00::1', '::ffff:127.0.0.1']) t.ok(isPrivateAddress(ip), ip)
  for (const ip of ['8.8.8.8', '2606:4700::1111']) t.notOk(isPrivateAddress(ip), ip)
})

test('refuses a local address and a bad protocol without a request', async (t) => {
  await t.rejects(fetchPreview('http://127.0.0.1:1/x'))
  await t.rejects(fetchPreview('ftp://example.com/x'))
})

test('the endpoint returns the preview, and 204 on failure', async (t) => {
  const dir = makeEmptyDataDir(t)
  process.env.SETBRAINZ_DATA_DIR = dir
  const app = createApp({ fetchPreview: async (url) => { if (url.endsWith('bad')) throw new Error('x'); return { title: 'T', artist: 'A' } } })
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.teardown(() => server.close())
  const base = `http://127.0.0.1:${server.address().port}`
  const ok = await fetch(`${base}/api/link-preview?url=${encodeURIComponent('https://example.com/ok')}`)
  t.same(await ok.json(), { title: 'T', artist: 'A' })
  const bad = await fetch(`${base}/api/link-preview?url=${encodeURIComponent('https://example.com/bad')}`)
  t.equal(bad.status, 204)
})
