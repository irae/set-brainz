import { test } from 'tap'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { makeEmptyDataDir, makeMergedRow, writeMergedFile, writeDecisionsFile } from './helpers/fixtures.js'
import { listSets, getSet } from '../app/store.js'

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
