import { test } from 'tap'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { makeEmptyDataDir, makeMergedRow, writeMergedFile, writeDecisionsFile } from './helpers/fixtures.js'
import { listSets, getSet, updateRow, mergeRow, insertEmptyRow, deleteRow, markPosted, isReadyToPost } from '../app/store.js'

function useDataDir(dir) {
  process.env.SETBRAINZ_DATA_DIR = dir
}

const NOW = '2026-01-01T00:00:00Z'

function decisionRow(overrides = {}) {
  return { id: 'decision-1', sources: [], start: null, track: null, note: '', updatedAt: NOW, ...overrides }
}

function decisionsDoc(videoId, mergedFile, rows) {
  return { videoId, mergedFile, createdAt: NOW, updatedAt: NOW, set: {}, rows }
}

test('store bootstrap (functional)', (t) => {
  t.test('it creates a decisions file from the newest merged file on first read', (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO01'
    const merged = writeMergedFile(dir, videoId, '20260101T000000Z-x.json')

    const result = getSet(videoId)

    t.equal(result.mergedFile, '20260101T000000Z-x.json')
    const onDisk = JSON.parse(readFileSync(join(dir, 'decisions', `${videoId}.json`), 'utf8'))
    t.equal(onDisk.mergedFile, '20260101T000000Z-x.json')
    t.equal(onDisk.rows.length, merged.rows.length)
    t.end()
  })

  t.test('it makes one decision row for each merged row, in the same order', (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO02'
    const rowA = makeMergedRow({ kind: 'track' })
    const rowB = makeMergedRow({ kind: 'gap', variants: [] })
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [rowA, rowB] })

    const result = getSet(videoId)

    t.equal(result.rows.length, 2)
    t.same(
      result.rows.map((row) => row.sources),
      [[rowA.uuid], [rowB.uuid]],
    )
    t.end()
  })

  t.test('it gives each decision row an id that differs from the merged row uuid', (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO03'
    const row = makeMergedRow()
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [row] })

    const result = getSet(videoId)

    t.ok(result.rows[0].id)
    t.not(result.rows[0].id, row.uuid)
    t.end()
  })

  t.test('it does not change the merged file', (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO04'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json')
    const mergedPath = join(dir, 'merged', videoId, '20260101T000000Z-x.json')
    const before = readFileSync(mergedPath, 'utf8')

    getSet(videoId)

    t.equal(readFileSync(mergedPath, 'utf8'), before)
    t.end()
  })

  t.test('it reads the file only once for two calls in a row', (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO05'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json')

    const first = getSet(videoId)
    rmSync(join(dir, 'decisions', `${videoId}.json`))
    const second = getSet(videoId)

    t.same(
      second.rows.map((row) => row.id),
      first.rows.map((row) => row.id),
    )
    t.end()
  })

  t.end()
})

test('store listSets (functional)', (t) => {
  t.test('it lists a video with decisions and a video with merged files only', (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const decided = 'TESTVIDEO06'
    const mergedOnly = 'TESTVIDEO07'
    const row = makeMergedRow()
    writeMergedFile(dir, decided, '20260101T000000Z-x.json', { rows: [row] })
    writeDecisionsFile(
      dir,
      decided,
      decisionsDoc(decided, '20260101T000000Z-x.json', [
        decisionRow({ sources: [row.uuid], start: { seconds: 5, from: 'best' } }),
      ]),
    )
    writeMergedFile(dir, mergedOnly, '20260101T000000Z-y.json')

    const result = listSets()

    t.same(
      result.withDecisions.map((entry) => entry.videoId),
      [decided],
    )
    t.same(
      result.mergedOnly.map((entry) => entry.videoId),
      [mergedOnly],
    )
    t.end()
  })

  t.test('it counts decided rows and total rows', (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO08'
    const rowA = makeMergedRow()
    const rowB = makeMergedRow()
    const rowC = makeMergedRow()
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [rowA, rowB, rowC] })
    writeDecisionsFile(
      dir,
      videoId,
      decisionsDoc(videoId, '20260101T000000Z-x.json', [
        decisionRow({ sources: [rowA.uuid], start: { seconds: 5, from: 'best' } }),
        decisionRow({ sources: [rowB.uuid] }),
        decisionRow({ sources: [rowC.uuid] }),
      ]),
    )

    const result = listSets()

    const entry = result.withDecisions.find((e) => e.videoId === videoId)
    t.equal(entry.rowCount, 3)
    t.equal(entry.decidedCount, 1)
    t.end()
  })

  t.test('it marks a video whose merged folder holds a newer file', (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO09'
    const row = makeMergedRow()
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [row] })
    writeDecisionsFile(
      dir,
      videoId,
      decisionsDoc(videoId, '20260101T000000Z-x.json', [decisionRow({ sources: [row.uuid] })]),
    )
    writeMergedFile(dir, videoId, '20260102T000000Z-x.json', { rows: [row] })

    const result = listSets()

    const entry = result.withDecisions.find((e) => e.videoId === videoId)
    t.ok(entry, 'video is listed')
    t.equal(entry.hasNewerMerge, true)
    t.end()
  })

  t.test('it writes no decisions file for the index, and a video without one stays merged-only across two calls', (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO12'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json')

    const first = listSets()
    const second = listSets()

    t.notOk(existsSync(join(dir, 'decisions', `${videoId}.json`)), 'no decisions file written')
    t.ok(
      first.mergedOnly.some((e) => e.videoId === videoId),
      'merged-only after the first call',
    )
    t.ok(
      second.mergedOnly.some((e) => e.videoId === videoId),
      'still merged-only after the second call',
    )
    t.end()
  })

  t.end()
})

test('store getSet (functional)', (t) => {
  t.test('it joins each decision row with the merged row it points to', (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO10'
    const row = makeMergedRow({ kind: 'track' })
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [row] })

    const result = getSet(videoId)

    t.equal(result.rows[0].merged.length, 1)
    t.equal(result.rows[0].merged[0].uuid, row.uuid)
    t.equal(result.rows[0].merged[0].kind, 'track')
    t.end()
  })

  t.test('it returns an empty merged list for a row without sources', (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO11'
    const row = makeMergedRow()
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [row] })
    writeDecisionsFile(
      dir,
      videoId,
      decisionsDoc(videoId, '20260101T000000Z-x.json', [decisionRow({ sources: [] })]),
    )

    const result = getSet(videoId)

    t.same(result.rows[0].merged, [])
    t.end()
  })

  t.test('it fails with a clear message for an unknown video id', (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)

    t.throws(() => getSet('TESTVIDEONONE'), /TESTVIDEONONE/)
    t.end()
  })

  t.end()
})

test('store 1001Tracklists fields (functional)', (t) => {
  t.test('updateRow accepts a track with links and the file holds it', async (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO31'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
    const before = getSet(videoId)
    const rowId = before.rows[0].id

    await updateRow(videoId, rowId, {
      track: { artists: 'Fixture Artist', title: 'Fixture Title', links: [{ kind: 'spotify', url: 'https://open.spotify.com/track/x' }] },
    })
    const after = getSet(videoId)

    t.same(after.rows[0].track.links, [{ kind: 'spotify', url: 'https://open.spotify.com/track/x' }])
    t.end()
  })

  t.test('updateRow rejects a link with an unknown kind', async (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO32'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
    const before = getSet(videoId)
    const rowId = before.rows[0].id

    t.throws(
      () => updateRow(videoId, rowId, { track: { links: [{ kind: 'napster', url: 'https://example.com/x' }] } }),
      { code: 'invalid_track' },
    )
    t.end()
  })

  t.test('updateRow rejects a link with a non-https url', async (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO33'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
    const before = getSet(videoId)
    const rowId = before.rows[0].id

    t.throws(
      () => updateRow(videoId, rowId, { track: { links: [{ kind: 'spotify', url: 'http://open.spotify.com/track/x' }] } }),
      { code: 'invalid_track' },
    )
    t.end()
  })

  t.test('updateRow rejects a links entry that is null', async (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO38'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
    const before = getSet(videoId)
    const rowId = before.rows[0].id

    t.throws(
      () => updateRow(videoId, rowId, { track: { links: [null] } }),
      { code: 'invalid_track' },
    )
    t.end()
  })

  t.test('updateRow rejects links that is not a list', async (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO34'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
    const before = getSet(videoId)
    const rowId = before.rows[0].id

    t.throws(
      () => updateRow(videoId, rowId, { track: { links: 'https://open.spotify.com/track/x' } }),
      { code: 'invalid_track' },
    )
    t.end()
  })

  t.test('updateRow rejects a patch that carries posted', async (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO35'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
    const before = getSet(videoId)
    const rowId = before.rows[0].id

    t.throws(
      () => updateRow(videoId, rowId, { posted: { at: NOW, suggestionId: '1', siteRowId: '1', trackNo: 1, payload: {}, response: {} } }),
      { code: 'posted_is_read_only' },
    )
    t.end()
  })

  t.test('updateRow accepts start with from typed', async (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO36'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
    const before = getSet(videoId)
    const rowId = before.rows[0].id

    await updateRow(videoId, rowId, { start: { seconds: 7, from: 'typed' } })
    const after = getSet(videoId)

    t.same(after.rows[0].start, { seconds: 7, from: 'typed' })
    t.end()
  })

  t.test('markPosted writes posted and updatedAt, copies the prev file, and refuses a second call', async (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO37'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
    const before = getSet(videoId)
    const rowId = before.rows[0].id
    const prevFilePath = join(dir, 'decisions', `${videoId}.prev.json`)
    const posted = { at: NOW, suggestionId: 'sug-1', siteRowId: 'row-1', trackNo: 1, payload: { a: 1 }, response: { ok: true } }

    markPosted(videoId, rowId, posted)
    const after = getSet(videoId)

    t.same(after.rows[0].posted, posted)
    t.ok(after.rows[0].updatedAt)
    t.ok(existsSync(prevFilePath))
    t.throws(() => markPosted(videoId, rowId, posted), { code: 'already_posted' })
    t.end()
  })

  t.test('isReadyToPost', (t) => {
    const base = decisionRow({
      start: { seconds: 1, from: 'best' },
      track: { artists: 'Fixture Artist', title: 'Fixture Title', links: [{ kind: 'spotify', url: 'https://example.com/x' }] },
    })

    t.equal(isReadyToPost(base), true)
    t.equal(isReadyToPost({ ...base, track: { ...base.track, links: [] } }), false)
    t.equal(isReadyToPost({ ...base, track: { ...base.track, links: undefined } }), false)
    t.equal(isReadyToPost({ ...base, track: { ...base.track, isId: true } }), false)
    t.equal(isReadyToPost({ ...base, posted: { at: NOW } }), false)
    t.end()
  })

  t.end()
})

test('store changes (functional)', (t) => {
  t.test('it saves a decided start and returns it on the next read', async (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO13'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
    const before = getSet(videoId)
    const rowId = before.rows[0].id

    await updateRow(videoId, rowId, { start: { seconds: 42, from: 'best' } })
    const after = getSet(videoId)

    t.same(after.rows[0].start, { seconds: 42, from: 'best' })
    t.end()
  })

  t.test('it saves track fields and keeps the fields it did not get', async (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO14'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
    const before = getSet(videoId)
    const rowId = before.rows[0].id
    await updateRow(videoId, rowId, { start: { seconds: 10, from: 'best' } })

    await updateRow(videoId, rowId, { track: { artists: 'Fixture Artist', title: 'Fixture Title' } })
    const after = getSet(videoId)

    t.same(after.rows[0].track, { artists: 'Fixture Artist', title: 'Fixture Title' })
    t.same(after.rows[0].start, { seconds: 10, from: 'best' })
    t.end()
  })

  t.test('it saves a note without touching the track fields', async (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO15'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
    const before = getSet(videoId)
    const rowId = before.rows[0].id
    await updateRow(videoId, rowId, { track: { artists: 'Fixture Artist', title: 'Fixture Title' } })

    await updateRow(videoId, rowId, { note: 'check this drop' })
    const after = getSet(videoId)

    t.equal(after.rows[0].note, 'check this drop')
    t.same(after.rows[0].track, { artists: 'Fixture Artist', title: 'Fixture Title' })
    t.end()
  })

  t.test('it merges a row with the row above and keeps both sources', async (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO16'
    const rowA = makeMergedRow()
    const rowB = makeMergedRow()
    const rowC = makeMergedRow()
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [rowA, rowB, rowC] })
    const before = getSet(videoId)

    await mergeRow(videoId, before.rows[1].id, 'up')
    const after = getSet(videoId)

    t.equal(after.rows.length, 2)
    t.same(after.rows[0].sources, [rowA.uuid, rowB.uuid])
    t.same(after.rows[1].sources, [rowC.uuid])
    t.end()
  })

  t.test('it merges a row with the row below and keeps both sources', async (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO17'
    const rowA = makeMergedRow()
    const rowB = makeMergedRow()
    const rowC = makeMergedRow()
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [rowA, rowB, rowC] })
    const before = getSet(videoId)

    await mergeRow(videoId, before.rows[1].id, 'down')
    const after = getSet(videoId)

    t.equal(after.rows.length, 2)
    t.same(after.rows[0].sources, [rowA.uuid])
    t.same(after.rows[1].sources, [rowB.uuid, rowC.uuid])
    t.end()
  })

  t.test('a merge takes the start from the row that goes away, when the surviving row has none', async (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO27'
    const rowA = makeMergedRow()
    const rowB = makeMergedRow()
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [rowA, rowB] })
    const before = getSet(videoId)
    await updateRow(videoId, before.rows[1].id, { start: { seconds: 42, from: 'best' } })

    await mergeRow(videoId, before.rows[1].id, 'up')
    const after = getSet(videoId)

    t.same(after.rows[0].start, { seconds: 42, from: 'best' })
    t.end()
  })

  t.test('a merge takes the track from the row that goes away, when the surviving row has none', async (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO28'
    const rowA = makeMergedRow()
    const rowB = makeMergedRow()
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [rowA, rowB] })
    const before = getSet(videoId)
    await updateRow(videoId, before.rows[1].id, { track: { artists: 'Fixture Artist', title: 'Fixture Title' } })

    await mergeRow(videoId, before.rows[1].id, 'up')
    const after = getSet(videoId)

    t.same(after.rows[0].track, { artists: 'Fixture Artist', title: 'Fixture Title' })
    t.end()
  })

  t.test('a merge takes the note from the row that goes away, when the surviving row has none', async (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO29'
    const rowA = makeMergedRow()
    const rowB = makeMergedRow()
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [rowA, rowB] })
    const before = getSet(videoId)
    await updateRow(videoId, before.rows[1].id, { note: 'check this drop' })

    await mergeRow(videoId, before.rows[1].id, 'up')
    const after = getSet(videoId)

    t.equal(after.rows[0].note, 'check this drop')
    t.end()
  })

  t.test('a merge keeps the surviving row\'s start, track and note when both rows hold one', async (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO30'
    const rowA = makeMergedRow()
    const rowB = makeMergedRow()
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [rowA, rowB] })
    const before = getSet(videoId)
    await updateRow(videoId, before.rows[0].id, {
      start: { seconds: 10, from: 'best' },
      track: { artists: 'Earlier Artist', title: 'Earlier Title' },
      note: 'earlier note',
    })
    await updateRow(videoId, before.rows[1].id, {
      start: { seconds: 99, from: 'best' },
      track: { artists: 'Later Artist', title: 'Later Title' },
      note: 'later note',
    })

    await mergeRow(videoId, before.rows[1].id, 'up')
    const after = getSet(videoId)

    t.same(after.rows[0].start, { seconds: 10, from: 'best' })
    t.same(after.rows[0].track, { artists: 'Earlier Artist', title: 'Earlier Title' })
    t.equal(after.rows[0].note, 'earlier note')
    t.end()
  })

  t.test('it refuses a merge up on the first row and a merge down on the last row', (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO18'
    const rowA = makeMergedRow()
    const rowB = makeMergedRow()
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [rowA, rowB] })
    const before = getSet(videoId)

    t.throws(() => mergeRow(videoId, before.rows[0].id, 'up'))
    t.throws(() => mergeRow(videoId, before.rows[1].id, 'down'))
    t.end()
  })

  t.test('it inserts an empty row above and below, with no sources', async (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO19'
    const rowA = makeMergedRow()
    const rowB = makeMergedRow()
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [rowA, rowB] })
    const before = getSet(videoId)
    const [decisionA, decisionB] = before.rows

    await insertEmptyRow(videoId, decisionA.id, 'above')
    await insertEmptyRow(videoId, decisionB.id, 'below')
    const after = getSet(videoId)

    t.equal(after.rows.length, 4)
    t.same(
      after.rows.map((row) => row.sources),
      [[], [rowA.uuid], [rowB.uuid], []],
    )
    t.end()
  })

  t.test('it refuses an unknown insert position', (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO24'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
    const before = getSet(videoId)

    t.throws(() => insertEmptyRow(videoId, before.rows[0].id, 'sideways'))
    t.end()
  })

  t.test('it deletes a row and keeps the order of the others', async (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO20'
    const rowA = makeMergedRow()
    const rowB = makeMergedRow()
    const rowC = makeMergedRow()
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [rowA, rowB, rowC] })
    const before = getSet(videoId)

    await deleteRow(videoId, before.rows[1].id)
    const after = getSet(videoId)

    t.same(
      after.rows.map((row) => row.sources),
      [[rowA.uuid], [rowC.uuid]],
    )
    t.end()
  })

  t.test('it writes the previous file to <video-id>.prev.json before each change', async (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO21'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
    const before = getSet(videoId)
    const rowId = before.rows[0].id
    const decisionsFilePath = join(dir, 'decisions', `${videoId}.json`)
    const prevFilePath = join(dir, 'decisions', `${videoId}.prev.json`)
    const contentBeforeFirstChange = readFileSync(decisionsFilePath, 'utf8')

    await updateRow(videoId, rowId, { note: 'first change' })

    t.ok(existsSync(prevFilePath))
    t.equal(readFileSync(prevFilePath, 'utf8'), contentBeforeFirstChange)

    const contentAfterFirstChange = readFileSync(decisionsFilePath, 'utf8')
    await updateRow(videoId, rowId, { note: 'second change' })

    t.equal(readFileSync(prevFilePath, 'utf8'), contentAfterFirstChange)
    t.end()
  })

  t.test('it keeps changes after a fresh store instance reads the file again', async (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO22'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
    const before = getSet(videoId)
    const rowId = before.rows[0].id

    await updateRow(videoId, rowId, { note: 'saved for real' })

    const freshStore = await import(`../app/store.js?fresh=${randomUUID()}`)
    const after = freshStore.getSet(videoId)

    t.equal(after.rows[0].note, 'saved for real')
    t.end()
  })

  t.test('it keeps both changes when they run one after the other, and .prev.json holds the state before the second', async (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO23'
    const rowA = makeMergedRow()
    const rowB = makeMergedRow()
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [rowA, rowB] })
    const before = getSet(videoId)
    const [decisionA, decisionB] = before.rows
    const decisionsFilePath = join(dir, 'decisions', `${videoId}.json`)
    const prevFilePath = join(dir, 'decisions', `${videoId}.prev.json`)

    await updateRow(videoId, decisionA.id, { note: 'from A' })
    const contentAfterFirstChange = readFileSync(decisionsFilePath, 'utf8')
    await updateRow(videoId, decisionB.id, { note: 'from B' })

    const onDisk = JSON.parse(readFileSync(decisionsFilePath, 'utf8'))
    t.equal(onDisk.rows[0].note, 'from A')
    t.equal(onDisk.rows[1].note, 'from B')
    t.equal(readFileSync(prevFilePath, 'utf8'), contentAfterFirstChange)
    t.end()
  })

  t.test('it leaves an earlier .prev.json untouched when a change is refused', async (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO25'
    const rowA = makeMergedRow()
    const rowB = makeMergedRow()
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [rowA, rowB] })
    const before = getSet(videoId)
    const prevFilePath = join(dir, 'decisions', `${videoId}.prev.json`)

    await updateRow(videoId, before.rows[0].id, { note: 'kept' })
    const prevContentBeforeRefusal = readFileSync(prevFilePath, 'utf8')

    t.throws(() => mergeRow(videoId, before.rows[0].id, 'up'))
    t.throws(() => updateRow(videoId, 'no-such-row', { note: 'nope' }))

    t.equal(readFileSync(prevFilePath, 'utf8'), prevContentBeforeRefusal)
    t.end()
  })

  t.test('it creates no .prev.json when a change is refused and none existed', (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO26'
    const rowA = makeMergedRow()
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [rowA] })
    const before = getSet(videoId)
    const prevFilePath = join(dir, 'decisions', `${videoId}.prev.json`)

    t.throws(() => mergeRow(videoId, before.rows[0].id, 'up'))
    t.throws(() => updateRow(videoId, 'no-such-row', { note: 'nope' }))

    t.notOk(existsSync(prevFilePath))
    t.end()
  })

  t.end()
})
