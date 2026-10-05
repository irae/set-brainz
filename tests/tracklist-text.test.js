import { test } from 'tap'
import { once } from 'node:events'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeEmptyDataDir, makeMergedRow, writeMergedFile, writeDecisionsFile } from './helpers/fixtures.js'
import { createApp } from '../app/server.js'

let counter = 0

function row(id, start, track) {
  return { id, sources: [], start: start === null ? null : { seconds: start, from: 'best' }, track, note: '', posted: null, updatedAt: '2026-01-01T00:00:00Z' }
}

async function textFor(t, rows) {
  const videoId = `TESTVIDEO0${++counter}`
  const dir = makeEmptyDataDir(t)
  writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
  mkdirSync(join(dir, 'runs', videoId), { recursive: true })
  writeFileSync(join(dir, 'runs', videoId, 'info.txt'), 'Fixture Set @ Fixture Venue 2026|3:00:00|x')
  writeDecisionsFile(dir, videoId, { videoId, mergedFile: '20260101T000000Z-x.json', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', set: {}, rows })
  process.env.SETBRAINZ_DATA_DIR = dir
  const server = createApp().listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.teardown(() => server.close())
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/sets/${videoId}/tracklist.txt`)
  return { res, body: await res.text() }
}

test('tracklist text (functional)', (t) => {
  t.test('it prints the title, a blank line, then decided rows in start order', async (t) => {
    const { res, body } = await textFor(t, [
      row('b', 3725, { artists: 'Fixture B', title: 'Track B', label: 'LABELB' }),
      row('a', 65, { artists: 'Fixture A', title: 'Track A', version: 'Fixture Remix' }),
      row('c', 130, { isId: true }),
    ])
    t.equal(res.status, 200)
    t.match(res.headers.get('content-type'), /text\/plain/)
    t.equal(body, 'Fixture Set @ Fixture Venue 2026\n\n[01:05] Fixture A - Track A (Fixture Remix)\n[02:10] ID - ID\n[1:02:05] Fixture B - Track B [LABELB]\n')
  })

  t.test('it leaves out undecided rows and rows without a start or a track', async (t) => {
    const { body } = await textFor(t, [
      row('a', null, null),
      row('b', 10, null),
      row('c', null, { artists: 'Fixture A', title: 'Track A' }),
      row('d', 20, { artists: 'Fixture D', title: 'Track D' }),
    ])
    t.equal(body, 'Fixture Set @ Fixture Venue 2026\n\n[00:20] Fixture D - Track D\n')
  })

  t.test('it prints only the title for a set with no decided rows', async (t) => {
    const { body } = await textFor(t, [row('a', null, null)])
    t.equal(body, 'Fixture Set @ Fixture Venue 2026\n\n')
  })

  t.test('it answers 404 for an unknown set', async (t) => {
    const dir = makeEmptyDataDir(t)
    process.env.SETBRAINZ_DATA_DIR = dir
    const server = createApp().listen(0, '127.0.0.1')
    await once(server, 'listening')
    t.teardown(() => server.close())
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/sets/TESTVIDEO99/tracklist.txt`)
    t.equal(res.status, 404)
  })
  t.end()
})
