import { test } from 'tap'
import { once } from 'node:events'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { makeEmptyDataDir, makeMergedRow, writeMergedFile } from './helpers/fixtures.js'
import { createApp } from '../app/server.js'

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'public')

async function startServer(t, dir) {
  process.env.SETBRAINZ_DATA_DIR = dir
  const app = createApp()
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.teardown(() => server.close())
  return `http://127.0.0.1:${server.address().port}`
}

function withShellFile(t, name, content) {
  mkdirSync(publicDir, { recursive: true })
  const path = join(publicDir, name)
  const existedBefore = existsSync(path)
  const original = existedBefore ? readFileSync(path, 'utf8') : null
  writeFileSync(path, content)
  const restore = () => {
    if (existedBefore) writeFileSync(path, original)
    else rmSync(path, { force: true })
  }
  process.on('exit', restore)
  t.teardown(restore)
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

test('static files (functional)', (t) => {
  t.test('it serves the set page shell for GET /sets/:videoId', async (t) => {
    withShellFile(t, 'set.html', '<!doctype html><title>Set shell</title>')
    const dir = makeEmptyDataDir(t)
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
