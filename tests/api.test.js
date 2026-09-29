import { test } from 'tap'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeEmptyDataDir, makeMergedRow, writeMergedFile } from './helpers/fixtures.js'
import { createApp } from '../app/server.js'

async function startServer(t, dir, options) {
  process.env.SETBRAINZ_DATA_DIR = dir
  const app = createApp(options)
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.teardown(() => server.close())
  return `http://127.0.0.1:${server.address().port}`
}

function writeTracklistUrl(dir, videoId, url) {
  mkdirSync(join(dir, '1001'), { recursive: true })
  writeFileSync(join(dir, '1001', 'tracklists.json'), JSON.stringify({ [videoId]: url }))
}

async function makeReadyRow(base, videoId, rowId, { links = [{ kind: 'spotify', url: 'https://open.spotify.com/track/fixture' }] } = {}) {
  await fetch(`${base}/api/sets/${videoId}/rows/${rowId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ start: { seconds: 10, from: 'best' } }),
  })
  await fetch(`${base}/api/sets/${videoId}/rows/${rowId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ track: { artists: 'Fixture Artist', title: 'Fixture Title', links } }),
  })
}

function makeTempPublicDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'set-brainz-public-'))
  t.teardown(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('api sets (functional)', (t) => {
  t.test('it returns the two index sections from GET /api/sets', async (t) => {
    const dir = makeEmptyDataDir(t)
    const videoId = 'TESTVIDEO30'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json')
    const base = await startServer(t, dir)

    const res = await fetch(`${base}/api/sets`)
    const body = await res.json()

    t.equal(res.status, 200)
    t.ok(Array.isArray(body.withDecisions))
    t.ok(Array.isArray(body.mergedOnly))
    t.same(
      body.mergedOnly.map((entry) => entry.videoId),
      [videoId],
    )
    t.end()
  })

  t.test('it returns the joined rows from GET /api/sets/:videoId', async (t) => {
    const dir = makeEmptyDataDir(t)
    const videoId = 'TESTVIDEO31'
    const row = makeMergedRow()
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [row] })
    const base = await startServer(t, dir)

    const res = await fetch(`${base}/api/sets/${videoId}`)
    const body = await res.json()

    t.equal(res.status, 200)
    t.equal(body.rows.length, 1)
    t.equal(body.rows[0].merged[0].uuid, row.uuid)
    t.end()
  })

  t.test('it answers 404 for an unknown video id', async (t) => {
    const dir = makeEmptyDataDir(t)
    const base = await startServer(t, dir)

    const res = await fetch(`${base}/api/sets/TESTVIDEONONE`)

    t.equal(res.status, 404)
    t.end()
  })

  t.test('GET /api/sets/:videoId holds a track number on each row', async (t) => {
    const dir = makeEmptyDataDir(t)
    const videoId = 'TESTVIDEO59'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow(), makeMergedRow()] })
    const base = await startServer(t, dir)
    const before = await (await fetch(`${base}/api/sets/${videoId}`)).json()
    const firstRowId = before.rows[0].id
    await fetch(`${base}/api/sets/${videoId}/rows/${firstRowId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ start: { seconds: 10, from: 'best' } }),
    })
    await fetch(`${base}/api/sets/${videoId}/rows/${firstRowId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track: { artists: 'Fixture Artist', title: 'Fixture Title' } }),
    })

    const after = await (await fetch(`${base}/api/sets/${videoId}`)).json()

    t.equal(after.rows[0].number, 1)
    t.equal(after.rows[1].number, null)
    t.end()
  })

  t.end()
})

test('api row changes (functional)', (t) => {
  t.test('it saves a start through PATCH and returns it on the next GET', async (t) => {
    const dir = makeEmptyDataDir(t)
    const videoId = 'TESTVIDEO32'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
    const base = await startServer(t, dir)
    const before = await (await fetch(`${base}/api/sets/${videoId}`)).json()
    const rowId = before.rows[0].id

    const patchRes = await fetch(`${base}/api/sets/${videoId}/rows/${rowId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ start: { seconds: 42, from: 'best' } }),
    })
    const after = await (await fetch(`${base}/api/sets/${videoId}`)).json()

    t.equal(patchRes.status, 200)
    t.same(after.rows[0].start, { seconds: 42, from: 'best' })
    t.end()
  })

  t.test('it saves track fields through PATCH and keeps the other fields', async (t) => {
    const dir = makeEmptyDataDir(t)
    const videoId = 'TESTVIDEO33'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
    const base = await startServer(t, dir)
    const before = await (await fetch(`${base}/api/sets/${videoId}`)).json()
    const rowId = before.rows[0].id
    await fetch(`${base}/api/sets/${videoId}/rows/${rowId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note: 'check this drop' }),
    })

    const patchRes = await fetch(`${base}/api/sets/${videoId}/rows/${rowId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track: { artists: 'Fixture Artist', title: 'Fixture Title' } }),
    })
    const after = await (await fetch(`${base}/api/sets/${videoId}`)).json()

    t.equal(patchRes.status, 200)
    t.same(after.rows[0].track, { artists: 'Fixture Artist', title: 'Fixture Title' })
    t.equal(after.rows[0].note, 'check this drop')
    t.end()
  })

  t.test('it merges a row through POST merge', async (t) => {
    const dir = makeEmptyDataDir(t)
    const videoId = 'TESTVIDEO34'
    const rowA = makeMergedRow()
    const rowB = makeMergedRow()
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [rowA, rowB] })
    const base = await startServer(t, dir)
    const before = await (await fetch(`${base}/api/sets/${videoId}`)).json()
    const rowId = before.rows[1].id

    const res = await fetch(`${base}/api/sets/${videoId}/rows/${rowId}/merge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ direction: 'up' }),
    })
    const after = await (await fetch(`${base}/api/sets/${videoId}`)).json()

    t.equal(res.status, 200)
    t.equal(after.rows.length, 1)
    t.same(after.rows[0].sources, [rowA.uuid, rowB.uuid])
    t.end()
  })

  t.test('it inserts an empty row through POST insert', async (t) => {
    const dir = makeEmptyDataDir(t)
    const videoId = 'TESTVIDEO35'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
    const base = await startServer(t, dir)
    const before = await (await fetch(`${base}/api/sets/${videoId}`)).json()
    const rowId = before.rows[0].id

    const res = await fetch(`${base}/api/sets/${videoId}/rows/${rowId}/insert`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ position: 'above' }),
    })
    const after = await (await fetch(`${base}/api/sets/${videoId}`)).json()

    t.equal(res.status, 200)
    t.equal(after.rows.length, 2)
    t.same(after.rows[0].sources, [])
    t.end()
  })

  t.test('it deletes a row through DELETE', async (t) => {
    const dir = makeEmptyDataDir(t)
    const videoId = 'TESTVIDEO36'
    const rowA = makeMergedRow()
    const rowB = makeMergedRow()
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [rowA, rowB] })
    const base = await startServer(t, dir)
    const before = await (await fetch(`${base}/api/sets/${videoId}`)).json()
    const rowId = before.rows[0].id

    const res = await fetch(`${base}/api/sets/${videoId}/rows/${rowId}`, { method: 'DELETE' })
    const after = await (await fetch(`${base}/api/sets/${videoId}`)).json()

    t.equal(res.status, 200)
    t.equal(after.rows.length, 1)
    t.same(after.rows[0].sources, [rowB.uuid])
    t.end()
  })

  t.test('it answers 400 for a bad direction or position', async (t) => {
    const dir = makeEmptyDataDir(t)
    const videoId = 'TESTVIDEO37'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow(), makeMergedRow()] })
    const base = await startServer(t, dir)
    const before = await (await fetch(`${base}/api/sets/${videoId}`)).json()
    const rowId = before.rows[0].id

    const mergeRes = await fetch(`${base}/api/sets/${videoId}/rows/${rowId}/merge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ direction: 'sideways' }),
    })
    const insertRes = await fetch(`${base}/api/sets/${videoId}/rows/${rowId}/insert`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ position: 'sideways' }),
    })

    t.equal(mergeRes.status, 400)
    t.equal(insertRes.status, 400)
    t.end()
  })

  t.test('it answers 404 for an unknown row id', async (t) => {
    const dir = makeEmptyDataDir(t)
    const videoId = 'TESTVIDEO38'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
    const base = await startServer(t, dir)

    const patchRes = await fetch(`${base}/api/sets/${videoId}/rows/no-such-row`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note: 'nope' }),
    })
    const deleteRes = await fetch(`${base}/api/sets/${videoId}/rows/no-such-row`, { method: 'DELETE' })

    t.equal(patchRes.status, 404)
    t.equal(deleteRes.status, 404)
    t.end()
  })

  t.test('it answers 400 for a merge at the first or last row', async (t) => {
    const dir = makeEmptyDataDir(t)
    const videoId = 'TESTVIDEO42'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow(), makeMergedRow()] })
    const base = await startServer(t, dir)
    const before = await (await fetch(`${base}/api/sets/${videoId}`)).json()
    const firstRowId = before.rows[0].id
    const lastRowId = before.rows[1].id

    const upRes = await fetch(`${base}/api/sets/${videoId}/rows/${firstRowId}/merge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ direction: 'up' }),
    })
    const downRes = await fetch(`${base}/api/sets/${videoId}/rows/${lastRowId}/merge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ direction: 'down' }),
    })

    t.equal(upRes.status, 400)
    t.equal(downRes.status, 400)
    t.end()
  })

  t.test('it answers 400 for a bad start.from value', async (t) => {
    const dir = makeEmptyDataDir(t)
    const videoId = 'TESTVIDEO43'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
    const base = await startServer(t, dir)
    const before = await (await fetch(`${base}/api/sets/${videoId}`)).json()
    const rowId = before.rows[0].id

    const res = await fetch(`${base}/api/sets/${videoId}/rows/${rowId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ start: { seconds: 10, from: 'sideways' } }),
    })

    t.equal(res.status, 400)
    t.end()
  })

  t.end()
})

test('api error handling (functional)', (t) => {
  t.test('it answers 500 with a short message and no stack when a merged file is damaged', async (t) => {
    const dir = makeEmptyDataDir(t)
    const videoId = 'TESTVIDEO44'
    const mergedDir = join(dir, 'merged', videoId)
    mkdirSync(mergedDir, { recursive: true })
    writeFileSync(join(mergedDir, '20260101T000000Z-x.json'), '{not valid json')
    const base = await startServer(t, dir)

    const res = await fetch(`${base}/api/sets/${videoId}`)
    const body = await res.json()

    t.equal(res.status, 500)
    t.equal(typeof body.error, 'string')
    t.notOk('stack' in body)
    t.notMatch(body.error, /\.js:\d+:\d+/)
    t.end()
  })

  t.test('it answers 400 with a short message and no stack for a malformed JSON body', async (t) => {
    const dir = makeEmptyDataDir(t)
    const videoId = 'TESTVIDEO45'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
    const base = await startServer(t, dir)
    const before = await (await fetch(`${base}/api/sets/${videoId}`)).json()
    const rowId = before.rows[0].id

    const res = await fetch(`${base}/api/sets/${videoId}/rows/${rowId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: '{not valid json',
    })
    const body = await res.json()

    t.equal(res.status, 400)
    t.equal(typeof body.error, 'string')
    t.notOk('stack' in body)
    t.end()
  })

  t.end()
})

test('api post to 1001tracklists (functional)', (t) => {
  t.test('it posts a ready row and logs the attempt', async (t) => {
    const dir = makeEmptyDataDir(t)
    const videoId = 'TESTVIDEO50'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
    const fakePostRow = async (args) => {
      t.same(args.cueSeconds, 10)
      t.same(args.trackNo, 0)
      t.equal(args.tracklistUrl, 'https://www.1001tracklists.com/tracklist/fixture/set.html')
      args.log({ event: 'open' })
      return {
        suggestionId: 'sug-1',
        siteRowId: 42,
        trackNo: 0,
        payload: { fixture: true },
        response: { success: true },
      }
    }
    const base = await startServer(t, dir, { postRow: fakePostRow })
    writeTracklistUrl(dir, videoId, 'https://www.1001tracklists.com/tracklist/fixture/set.html')
    const before = await (await fetch(`${base}/api/sets/${videoId}`)).json()
    const rowId = before.rows[0].id
    await makeReadyRow(base, videoId, rowId)

    const res = await fetch(`${base}/api/sets/${videoId}/rows/${rowId}/post-1001`, { method: 'POST' })
    const body = await res.json()

    t.equal(res.status, 200)
    t.equal(body.rows[0].posted.suggestionId, 'sug-1')
    const log = readFileSync(join(dir, '1001', 'post-log.jsonl'), 'utf8').trim().split('\n')
    t.ok(log.length >= 1)
    const firstLine = JSON.parse(log[0])
    t.equal(firstLine.videoId, videoId)
    t.equal(firstLine.rowId, rowId)
    t.equal(firstLine.event, 'open')
    t.end()
  })

  t.test('it answers 400 not_ready for a row without a link', async (t) => {
    const dir = makeEmptyDataDir(t)
    const videoId = 'TESTVIDEO51'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
    const base = await startServer(t, dir, { postRow: async () => { throw new Error('must not be called') } })
    const before = await (await fetch(`${base}/api/sets/${videoId}`)).json()
    const rowId = before.rows[0].id

    const res = await fetch(`${base}/api/sets/${videoId}/rows/${rowId}/post-1001`, { method: 'POST' })
    const body = await res.json()

    t.equal(res.status, 400)
    t.equal(body.code, 'not_ready')
    t.end()
  })

  t.test('it answers 409 for a row that is already posted', async (t) => {
    const dir = makeEmptyDataDir(t)
    const videoId = 'TESTVIDEO52'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
    writeTracklistUrl(dir, videoId, 'https://www.1001tracklists.com/tracklist/fixture/set.html')
    const fakePostRow = async () => ({
      suggestionId: 'sug-1',
      siteRowId: 42,
      trackNo: 0,
      payload: {},
      response: { success: true },
    })
    const base = await startServer(t, dir, { postRow: fakePostRow })
    const before = await (await fetch(`${base}/api/sets/${videoId}`)).json()
    const rowId = before.rows[0].id
    await makeReadyRow(base, videoId, rowId)
    await fetch(`${base}/api/sets/${videoId}/rows/${rowId}/post-1001`, { method: 'POST' })

    const res = await fetch(`${base}/api/sets/${videoId}/rows/${rowId}/post-1001`, { method: 'POST' })
    const body = await res.json()

    t.equal(res.status, 409)
    t.equal(body.code, 'already_posted')
    t.end()
  })

  t.test('it answers 400 no_tracklist_url when the map holds no entry', async (t) => {
    const dir = makeEmptyDataDir(t)
    const videoId = 'TESTVIDEO53'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
    const base = await startServer(t, dir, { postRow: async () => { throw new Error('must not be called') } })
    const before = await (await fetch(`${base}/api/sets/${videoId}`)).json()
    const rowId = before.rows[0].id
    await makeReadyRow(base, videoId, rowId)

    const res = await fetch(`${base}/api/sets/${videoId}/rows/${rowId}/post-1001`, { method: 'POST' })
    const body = await res.json()

    t.equal(res.status, 400)
    t.equal(body.code, 'no_tracklist_url')
    t.end()
  })

  t.test('it answers 502 and keeps the row unposted when the site rejects the suggestion', async (t) => {
    const dir = makeEmptyDataDir(t)
    const videoId = 'TESTVIDEO54'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
    writeTracklistUrl(dir, videoId, 'https://www.1001tracklists.com/tracklist/fixture/set.html')
    const fakePostRow = async (args) => {
      args.log({ event: 'error', message: 'site_rejected', code: 'site_rejected' })
      throw Object.assign(new Error('site_rejected: nope'), { code: 'site_rejected' })
    }
    const base = await startServer(t, dir, { postRow: fakePostRow })
    const before = await (await fetch(`${base}/api/sets/${videoId}`)).json()
    const rowId = before.rows[0].id
    await makeReadyRow(base, videoId, rowId)

    const res = await fetch(`${base}/api/sets/${videoId}/rows/${rowId}/post-1001`, { method: 'POST' })
    const body = await res.json()
    const after = await (await fetch(`${base}/api/sets/${videoId}`)).json()

    t.equal(res.status, 502)
    t.equal(body.code, 'site_rejected')
    t.notOk(after.rows[0].posted)
    t.end()
  })

  t.test('it sends trackNo equal to the row number minus one', async (t) => {
    const dir = makeEmptyDataDir(t)
    const videoId = 'TESTVIDEO55'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow(), makeMergedRow()] })
    writeTracklistUrl(dir, videoId, 'https://www.1001tracklists.com/tracklist/fixture/set.html')
    const seenTrackNos = []
    const fakePostRow = async (args) => {
      seenTrackNos.push(args.trackNo)
      return {
        suggestionId: `sug-${args.trackNo}`,
        siteRowId: 42 + args.trackNo,
        trackNo: args.trackNo,
        payload: {},
        response: { success: true },
      }
    }
    const base = await startServer(t, dir, { postRow: fakePostRow })
    const before = await (await fetch(`${base}/api/sets/${videoId}`)).json()
    const firstRowId = before.rows[0].id
    const secondRowId = before.rows[1].id
    await makeReadyRow(base, videoId, firstRowId)
    await makeReadyRow(base, videoId, secondRowId)

    await fetch(`${base}/api/sets/${videoId}/rows/${firstRowId}/post-1001`, { method: 'POST' })
    await fetch(`${base}/api/sets/${videoId}/rows/${secondRowId}/post-1001`, { method: 'POST' })

    t.same(seenTrackNos, [0, 1])
    t.end()
  })

  t.test('it answers 400 not_ready for a row after a row that is not complete', async (t) => {
    const dir = makeEmptyDataDir(t)
    const videoId = 'TESTVIDEO57'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow(), makeMergedRow()] })
    const base = await startServer(t, dir, { postRow: async () => { throw new Error('must not be called') } })
    const before = await (await fetch(`${base}/api/sets/${videoId}`)).json()
    const secondRowId = before.rows[1].id
    await makeReadyRow(base, videoId, secondRowId)

    const res = await fetch(`${base}/api/sets/${videoId}/rows/${secondRowId}/post-1001`, { method: 'POST' })
    const body = await res.json()

    t.equal(res.status, 400)
    t.equal(body.code, 'not_ready')
    t.end()
  })

  t.test('it reaches postRow with no link for an ID row', async (t) => {
    const dir = makeEmptyDataDir(t)
    const videoId = 'TESTVIDEO58'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
    writeTracklistUrl(dir, videoId, 'https://www.1001tracklists.com/tracklist/fixture/set.html')
    let seenLink = 'not set'
    const fakePostRow = async (args) => {
      seenLink = args.link
      return {
        suggestionId: 'sug-1',
        siteRowId: 42,
        trackNo: 0,
        payload: {},
        response: { success: true },
      }
    }
    const base = await startServer(t, dir, { postRow: fakePostRow })
    const before = await (await fetch(`${base}/api/sets/${videoId}`)).json()
    const rowId = before.rows[0].id
    await fetch(`${base}/api/sets/${videoId}/rows/${rowId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ start: { seconds: 10, from: 'best' } }),
    })
    await fetch(`${base}/api/sets/${videoId}/rows/${rowId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track: { isId: true } }),
    })

    const res = await fetch(`${base}/api/sets/${videoId}/rows/${rowId}/post-1001`, { method: 'POST' })

    t.equal(res.status, 200)
    t.equal(seenLink, undefined)
    t.end()
  })

  t.test('it reaches postRow with no link for a named row whose title holds the word ID', async (t) => {
    const dir = makeEmptyDataDir(t)
    const videoId = 'TESTVIDEO66'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
    writeTracklistUrl(dir, videoId, 'https://www.1001tracklists.com/tracklist/fixture/set.html')
    let seenLink = 'not set'
    const fakePostRow = async (args) => {
      seenLink = args.link
      return {
        suggestionId: 'sug-1',
        siteRowId: 42,
        trackNo: 0,
        payload: {},
        response: { success: true },
      }
    }
    const base = await startServer(t, dir, { postRow: fakePostRow })
    const before = await (await fetch(`${base}/api/sets/${videoId}`)).json()
    const rowId = before.rows[0].id
    await fetch(`${base}/api/sets/${videoId}/rows/${rowId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ start: { seconds: 10, from: 'best' } }),
    })
    await fetch(`${base}/api/sets/${videoId}/rows/${rowId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track: { artists: 'ID', title: 'Satisfaction (ID Remix)' } }),
    })

    const res = await fetch(`${base}/api/sets/${videoId}/rows/${rowId}/post-1001`, { method: 'POST' })

    t.equal(res.status, 200)
    t.equal(seenLink, undefined)
    t.end()
  })

  t.test('it answers 400 for a non-ID row without a link', async (t) => {
    const dir = makeEmptyDataDir(t)
    const videoId = 'TESTVIDEO62'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
    const base = await startServer(t, dir, { postRow: async () => { throw new Error('must not be called') } })
    const before = await (await fetch(`${base}/api/sets/${videoId}`)).json()
    const rowId = before.rows[0].id
    await fetch(`${base}/api/sets/${videoId}/rows/${rowId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ start: { seconds: 10, from: 'best' } }),
    })
    await fetch(`${base}/api/sets/${videoId}/rows/${rowId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track: { artists: 'Fixture Artist', title: 'Fixture Title' } }),
    })

    const res = await fetch(`${base}/api/sets/${videoId}/rows/${rowId}/post-1001`, { method: 'POST' })
    const body = await res.json()

    t.equal(res.status, 400)
    t.equal(body.code, 'not_ready')
    t.end()
  })

  t.test('it answers 409 post_in_progress for a second request while the first is still running', async (t) => {
    const dir = makeEmptyDataDir(t)
    const videoId = 'TESTVIDEO56'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
    writeTracklistUrl(dir, videoId, 'https://www.1001tracklists.com/tracklist/fixture/set.html')
    let runCount = 0
    let releaseFirst
    const gate = new Promise((resolve) => {
      releaseFirst = resolve
    })
    const fakePostRow = async () => {
      runCount += 1
      await gate
      return {
        suggestionId: 'sug-1',
        siteRowId: 42,
        trackNo: 0,
        payload: {},
        response: { success: true },
      }
    }
    const base = await startServer(t, dir, { postRow: fakePostRow })
    const before = await (await fetch(`${base}/api/sets/${videoId}`)).json()
    const rowId = before.rows[0].id
    await makeReadyRow(base, videoId, rowId)

    const firstRequest = fetch(`${base}/api/sets/${videoId}/rows/${rowId}/post-1001`, { method: 'POST' })
    await new Promise((resolve) => setTimeout(resolve, 20))
    const secondRes = await fetch(`${base}/api/sets/${videoId}/rows/${rowId}/post-1001`, { method: 'POST' })
    const secondBody = await secondRes.json()
    releaseFirst()
    const firstRes = await firstRequest

    t.equal(secondRes.status, 409)
    t.equal(secondBody.code, 'post_in_progress')
    t.equal(firstRes.status, 200)
    t.equal(runCount, 1)
    t.end()
  })

  t.test('it stores our own trackNo and the site anchorTrackNo when a post lands after the last site row', async (t) => {
    const dir = makeEmptyDataDir(t)
    const videoId = 'TESTVIDEO63'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
    writeTracklistUrl(dir, videoId, 'https://www.1001tracklists.com/tracklist/fixture/set.html')
    const fakePostRow = async () => ({
      suggestionId: 'sug-1',
      siteRowId: 42,
      trackNo: 5,
      payload: {},
      response: { success: true },
    })
    const base = await startServer(t, dir, { postRow: fakePostRow })
    const before = await (await fetch(`${base}/api/sets/${videoId}`)).json()
    const rowId = before.rows[0].id
    await makeReadyRow(base, videoId, rowId)

    const res = await fetch(`${base}/api/sets/${videoId}/rows/${rowId}/post-1001`, { method: 'POST' })
    const body = await res.json()

    t.equal(res.status, 200)
    t.equal(body.rows[0].posted.trackNo, 0)
    t.equal(body.rows[0].posted.anchorTrackNo, 5)
    t.end()
  })

  t.test('DELETE post-1001 clears the posted mark so the row can post again', async (t) => {
    const dir = makeEmptyDataDir(t)
    const videoId = 'TESTVIDEO64'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
    writeTracklistUrl(dir, videoId, 'https://www.1001tracklists.com/tracklist/fixture/set.html')
    const fakePostRow = async () => ({
      suggestionId: 'sug-1',
      siteRowId: 42,
      trackNo: 0,
      payload: {},
      response: { success: true },
    })
    const base = await startServer(t, dir, { postRow: fakePostRow })
    const before = await (await fetch(`${base}/api/sets/${videoId}`)).json()
    const rowId = before.rows[0].id
    await makeReadyRow(base, videoId, rowId)
    await fetch(`${base}/api/sets/${videoId}/rows/${rowId}/post-1001`, { method: 'POST' })

    const res = await fetch(`${base}/api/sets/${videoId}/rows/${rowId}/post-1001`, { method: 'DELETE' })
    const body = await res.json()

    t.equal(res.status, 200)
    t.notOk(body.rows[0].posted)
    t.equal(body.rows[0].postHistory.length, 1)
    t.equal(body.rows[0].postHistory[0].suggestionId, 'sug-1')
    t.end()
  })

  t.test('DELETE post-1001 answers 400 not_posted for a row without a post', async (t) => {
    const dir = makeEmptyDataDir(t)
    const videoId = 'TESTVIDEO65'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
    const base = await startServer(t, dir)
    const before = await (await fetch(`${base}/api/sets/${videoId}`)).json()
    const rowId = before.rows[0].id

    const res = await fetch(`${base}/api/sets/${videoId}/rows/${rowId}/post-1001`, { method: 'DELETE' })
    const body = await res.json()

    t.equal(res.status, 400)
    t.equal(body.code, 'not_posted')
    t.end()
  })

  t.end()
})

test('static files (functional)', (t) => {
  t.test('it serves the set page shell from the folder SETBRAINZ_PUBLIC_DIR names', async (t) => {
    const dir = makeEmptyDataDir(t)
    const publicDir = makeTempPublicDir(t)
    writeFileSync(join(publicDir, 'set.html'), '<!doctype html><title>Set shell</title>')
    process.env.SETBRAINZ_PUBLIC_DIR = publicDir
    t.teardown(() => {
      delete process.env.SETBRAINZ_PUBLIC_DIR
    })
    const base = await startServer(t, dir)

    const res = await fetch(`${base}/sets/TESTVIDEO39`)
    const body = await res.text()

    t.equal(res.status, 200)
    t.match(body, /Set shell/)
    t.end()
  })

  t.test('it serves jquery from the local disk without a network call', async (t) => {
    const dir = makeEmptyDataDir(t)
    const base = await startServer(t, dir)

    const res = await fetch(`${base}/vendor/jquery.js`)
    const body = await res.text()

    t.equal(res.status, 200)
    t.match(body, /jQuery JavaScript Library/)
    t.end()
  })

  t.end()
})
