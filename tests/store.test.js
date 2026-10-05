import { test } from 'tap'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { makeEmptyDataDir, makeMergedRow, writeMergedFile, writeDecisionsFile } from './helpers/fixtures.js'
import { listSets, getSet, updateRow, mergeRow, insertEmptyRow, deleteRow, markPosted, clearPosted, isReadyToPost, rowNumbers, createSourceSet, getSourceSet, updateSourceSet } from '../app/store.js'

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

test('store range entries (functional)', (t) => {
  let videoNumber = 70
  const variant = (title, start) => ({ title, artist: 'Fixture Artist', start, end: start + 1, tracklistify: [], ripthatset: [] })
  const titles = (row) => row.rangeEntries.flatMap((entry) => entry.kind === 'track' ? entry.variants.map((v) => v.title) : ['gap'])

  function setup(t, rows, decisions) {
    videoNumber += 1
    const videoId = `TESTVIDEO${videoNumber}`
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows })
    writeDecisionsFile(dir, videoId, decisionsDoc(videoId, '20260101T000000Z-x.json', decisions.map((d, i) => decisionRow({ id: `decision-${i + 1}`, ...d }))))
    return getSet(videoId)
  }

  t.test('a confirmed next row bounds the span and the variants at its cue stay out', (t) => {
    const own = makeMergedRow({ earliest: 10, best: 10, latest: 14, variants: [variant('Own', 10)] })
    const nearby = makeMergedRow({ earliest: 15, best: 15, latest: 25, variants: [variant('Inside start', 15), variant('Inside end', 19), variant('At next cue', 20)] })
    const after = makeMergedRow({ earliest: 20, best: 20, latest: 25, variants: [variant('After', 20)] })
    const result = setup(t, [own, nearby, after], [
      { sources: [own.uuid], start: { seconds: 10, from: 'typed' } },
      { sources: [nearby.uuid], start: { seconds: 20, from: 'typed' } },
      { sources: [after.uuid] },
    ])
    t.same(result.rows[0].span, { start: 10, end: 20 })
    t.same(titles(result.rows[0]), ['Own', 'Inside start', 'Inside end'])
    t.end()
  })

  t.test('an unconfirmed next row bounds the span at its earliest detection', (t) => {
    const own = makeMergedRow({ earliest: 100, best: 100, latest: 110, variants: [variant('Own', 100)] })
    const inside = makeMergedRow({ earliest: 120, best: 120, latest: 125, variants: [variant('Inside', 120)] })
    const next = makeMergedRow({ earliest: 200, best: 200, latest: 210, variants: [variant('Next', 200)] })
    const later = makeMergedRow({ earliest: 300, best: 300, latest: 310, variants: [variant('Later', 300)] })
    const result = setup(t, [own, inside, next, later], [
      { sources: [own.uuid, inside.uuid], start: { seconds: 95, from: 'grab' } },
      { sources: [next.uuid] },
      { sources: [later.uuid] },
    ])
    t.same(result.rows[0].span, { start: 95, end: 200 })
    t.same(titles(result.rows[0]), ['Own', 'Inside'])
    t.same(result.rows[1].span, { start: 200, end: 300 })
    t.same(titles(result.rows[1]), ['Next'])
    t.end()
  })

  t.test('a confirmed row with no next row and the last row end at the end of the set', (t) => {
    const own = makeMergedRow({ earliest: 100, best: 100, latest: 110, variants: [variant('Own', 100)] })
    const late = makeMergedRow({ earliest: 3000, best: 3000, latest: 3010, variants: [variant('Late', 3000)] })
    const result = setup(t, [own, late], [{ sources: [own.uuid, late.uuid], start: { seconds: 90, from: 'typed' } }])
    t.same(result.rows[0].span, { start: 90, end: 3600 })
    t.same(titles(result.rows[0]), ['Own', 'Late'])
    t.end()
  })

  t.test('an owner-added row with no sources and no start has no span and does not bound the row above', (t) => {
    const own = makeMergedRow({ earliest: 100, best: 100, latest: 110, variants: [variant('Own', 100)] })
    const middle = makeMergedRow({ earliest: 150, best: 150, latest: 160, variants: [variant('Middle', 150)] })
    const next = makeMergedRow({ earliest: 200, best: 200, latest: 210, variants: [variant('Next', 200)] })
    const result = setup(t, [own, middle, next], [
      { sources: [own.uuid, middle.uuid], start: { seconds: 100, from: 'typed' } },
      { sources: [] },
      { sources: [next.uuid] },
    ])
    t.same(result.rows[1].span, null)
    t.same(result.rows[1].rangeEntries, [])
    t.same(result.rows[0].span, { start: 100, end: 200 })
    t.same(titles(result.rows[0]), ['Own', 'Middle'])
    t.end()
  })

  t.test('an owner-added row with a start bounds the row above', (t) => {
    const own = makeMergedRow({ earliest: 100, best: 100, latest: 110, variants: [variant('Own', 100)] })
    const middle = makeMergedRow({ earliest: 150, best: 150, latest: 160, variants: [variant('Middle', 150)] })
    const result = setup(t, [own, middle], [
      { sources: [own.uuid], start: { seconds: 100, from: 'typed' } },
      { sources: [], start: { seconds: 140, from: 'typed' } },
    ])
    t.same(result.rows[0].span, { start: 100, end: 140 })
    t.same(titles(result.rows[0]), ['Own'])
    t.same(result.rows[1].span, { start: 140, end: 3600 })
    t.same(titles(result.rows[1]), ['Middle'])
    t.end()
  })

  t.test('every detection inside the span stays in the list, also those of deleted rows', (t) => {
    const own = makeMergedRow({ earliest: 10050, best: 10050, latest: 10060, variants: [variant('Loving', 10050)] })
    const excess = makeMergedRow({ earliest: 10100, best: 10100, latest: 10110, variants: [variant('Excess', 10100)] })
    const fashion = makeMergedRow({ earliest: 10116, best: 10116, latest: 10120, variants: [variant('Fashion', 10116)] })
    const apathy = makeMergedRow({ earliest: 10200, best: 10200, latest: 10210, variants: [variant('Apathy', 10200)] })
    const next = makeMergedRow({ earliest: 10300, best: 10300, latest: 10310, variants: [variant('Next', 10300)] })
    const result = setup(t, [own, excess, fashion, apathy, next], [
      { sources: [own.uuid], start: { seconds: 10045, from: 'typed' } },
      { sources: [next.uuid], start: { seconds: 10273, from: 'typed' } },
    ])
    t.same(result.rows[0].span, { start: 10045, end: 10273 })
    t.same(titles(result.rows[0]), ['Loving', 'Excess', 'Fashion', 'Apathy'])
    t.end()
  })

  t.test('an unconfirmed row starts at its earliest detection and a next row at or before that start does not bound it', (t) => {
    const first = makeMergedRow({ earliest: 500, best: 500, latest: 520, variants: [variant('First', 500)] })
    const overlap = makeMergedRow({ earliest: 480, best: 480, latest: 490, variants: [variant('Overlap', 480)] })
    const last = makeMergedRow({ earliest: 700, best: 700, latest: 710, variants: [variant('Last', 700)] })
    const result = setup(t, [first, overlap, last], [
      { sources: [first.uuid] },
      { sources: [overlap.uuid] },
      { sources: [last.uuid] },
    ])
    t.same(result.rows[0].span, { start: 500, end: 700 })
    t.end()
  })

  t.test('a gap that overlaps the span is listed, and a gap after the span is not', (t) => {
    const own = makeMergedRow({ earliest: 100, best: 100, latest: 110, variants: [variant('Own', 100)] })
    const gap = makeMergedRow({ kind: 'gap', earliest: 150, best: 150, latest: 250, variants: [] })
    const farGap = makeMergedRow({ kind: 'gap', earliest: 400, best: 400, latest: 500, variants: [] })
    const next = makeMergedRow({ earliest: 300, best: 300, latest: 310, variants: [variant('Next', 300)] })
    const result = setup(t, [own, gap, farGap, next], [
      { sources: [own.uuid], start: { seconds: 100, from: 'typed' } },
      { sources: [next.uuid] },
    ])
    t.same(titles(result.rows[0]), ['Own', 'gap'])
    t.end()
  })

  t.test('the decided start wins over an earlier guess in the span start', (t) => {
    const own = makeMergedRow({ earliest: 100, best: 100, latest: 110, variants: [variant('Own', 100)] })
    const result = setup(t, [own], [{ sources: [own.uuid], start: { seconds: 130, from: 'typed' } }])
    t.same(result.rows[0].span, { start: 130, end: 3600 })
    t.end()
  })

  t.test('a merged row spans from the earliest of both sources and lists both', async (t) => {
    const a = makeMergedRow({ earliest: 100, best: 100, latest: 110, variants: [variant('A', 100)] })
    const b = makeMergedRow({ earliest: 150, best: 150, latest: 160, variants: [variant('B', 150)] })
    const c = makeMergedRow({ earliest: 300, best: 300, latest: 310, variants: [variant('C', 300)] })
    const before = setup(t, [a, b, c], [{ sources: [a.uuid] }, { sources: [b.uuid] }, { sources: [c.uuid] }])
    await mergeRow('TESTVIDEO' + videoNumber, before.rows[1].id, 'up')
    const after = getSet('TESTVIDEO' + videoNumber)
    t.same(after.rows[0].span, { start: 100, end: 300 })
    t.same(titles(after.rows[0]), ['A', 'B'])
    t.end()
  })

  t.end()
})

test('store source URL locks (functional)', (t) => {
  t.test('an MP3 locks a changed source URL but allows the same value', (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO85'
    const sourceUrl = `https://www.youtube.com/watch?v=${videoId}`
    createSourceSet({ url: sourceUrl, title: 'Fixture title' })
    const audioDir = join(dir, 'audio', videoId)
    mkdirSync(audioDir, { recursive: true })
    writeFileSync(join(audioDir, 'fixture.mp3'), 'fixture audio')

    t.equal(getSourceSet(videoId).sourceLocked, true)
    t.equal(updateSourceSet(videoId, { sourceUrl }).sourceUrl, sourceUrl)
    t.throws(
      () => updateSourceSet(videoId, { sourceUrl: 'https://example.com/changed-source' }),
      { code: 'source_locked' },
    )
    t.end()
  })

  t.test('a failed download without an MP3 allows a source URL correction', (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO86'
    const sourceUrl = `https://www.youtube.com/watch?v=${videoId}`
    createSourceSet({ url: sourceUrl, title: 'Fixture title' })
    mkdirSync(join(dir, 'jobs'), { recursive: true })
    writeFileSync(join(dir, 'jobs', `${videoId}.json`), JSON.stringify({
      videoId,
      phase: 'download',
      status: 'failed',
      step: 'download',
      startedAt: NOW,
      updatedAt: NOW,
      finishedAt: NOW,
      error: 'fixture failure',
    }))

    const updated = updateSourceSet(videoId, { sourceUrl: 'https://example.com/corrected-source' })

    t.equal(updated.sourceUrl, 'https://example.com/corrected-source')
    t.equal(updated.sourceLocked, false)
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
    const videoId = 'TESTVIDEO91'
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
    const videoId = 'TESTVIDEO92'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
    const before = getSet(videoId)
    const rowId = before.rows[0].id

    t.throws(
      () => updateRow(videoId, rowId, { track: { links: [{ kind: 'napster', url: 'https://example.com/x' }] } }),
      { code: 'invalid_track' },
    )
    t.end()
  })

  t.test('updateRow accepts a Bandcamp or SoundCloud link with kind other', async (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO33'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
    const before = getSet(videoId)
    const rowId = before.rows[0].id

    await updateRow(videoId, rowId, {
      track: { artists: 'Fixture Artist', title: 'Fixture Title', links: [{ kind: 'other', url: 'https://soundcloud.com/x/y' }] },
    })
    const after = getSet(videoId)

    t.same(after.rows[0].track.links, [{ kind: 'other', url: 'https://soundcloud.com/x/y' }])
    t.end()
  })

  t.test('updateRow accepts a link with an http:// url', async (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO39'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
    const before = getSet(videoId)
    const rowId = before.rows[0].id

    await updateRow(videoId, rowId, {
      track: { artists: 'Fixture Artist', title: 'Fixture Title', links: [{ kind: 'other', url: 'http://bandcamp.com/x' }] },
    })
    const after = getSet(videoId)

    t.same(after.rows[0].track.links, [{ kind: 'other', url: 'http://bandcamp.com/x' }])
    t.end()
  })

  t.test('updateRow rejects a link with an ftp url', async (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO40'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
    const before = getSet(videoId)
    const rowId = before.rows[0].id

    t.throws(
      () => updateRow(videoId, rowId, { track: { links: [{ kind: 'other', url: 'ftp://x' }] } }),
      { code: 'invalid_track' },
    )
    t.end()
  })

  t.test('updateRow rejects a link with text that is not a url', async (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO41'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
    const before = getSet(videoId)
    const rowId = before.rows[0].id

    t.throws(
      () => updateRow(videoId, rowId, { track: { links: [{ kind: 'other', url: 'not a url' }] } }),
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

  t.test('clearPosted moves posted into postHistory with clearedAt, and copies the prev file', async (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO60'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
    const before = getSet(videoId)
    const rowId = before.rows[0].id
    const posted = { at: NOW, suggestionId: 'sug-1', siteRowId: 'row-1', trackNo: 1, anchorTrackNo: 0, payload: { a: 1 }, response: { ok: true } }
    markPosted(videoId, rowId, posted)
    const prevFilePath = join(dir, 'decisions', `${videoId}.prev.json`)
    const prevContentBeforeClear = readFileSync(prevFilePath, 'utf8')

    clearPosted(videoId, rowId)
    const after = getSet(videoId)

    t.equal(after.rows[0].posted, null)
    t.equal(after.rows[0].postHistory.length, 1)
    t.match(after.rows[0].postHistory[0], { ...posted, clearedAt: /.+/ })
    t.not(readFileSync(prevFilePath, 'utf8'), prevContentBeforeClear)
    t.end()
  })

  t.test('clearPosted answers not_posted for a row without posted', (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO61'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
    const before = getSet(videoId)
    const rowId = before.rows[0].id

    t.throws(() => clearPosted(videoId, rowId), { code: 'not_posted' })
    t.end()
  })

  t.test('updateRow rejects a patch that carries postHistory', async (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO62'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
    const before = getSet(videoId)
    const rowId = before.rows[0].id

    t.throws(
      () => updateRow(videoId, rowId, { postHistory: [] }),
      { code: 'postHistory_is_read_only' },
    )
    t.end()
  })

  t.test('isReadyToPost', (t) => {
    const base = decisionRow({
      start: { seconds: 1, from: 'best' },
      track: { artists: 'Fixture Artist', title: 'Fixture Title', links: [{ kind: 'spotify', url: 'https://example.com/x' }] },
    })

    t.equal(isReadyToPost(base, 1), true, 'ready with a number and a link')
    t.equal(isReadyToPost(base, null), false, 'not ready without a number')
    t.equal(isReadyToPost({ ...base, track: { ...base.track, links: [] } }, 1), false, 'not ready with no link')
    t.equal(isReadyToPost({ ...base, track: { isId: true } }, 1), true, 'an ID row needs no link')
    t.equal(isReadyToPost({ ...base, posted: { at: NOW } }, 1), false, 'not ready once posted')
    t.equal(
      isReadyToPost({ ...base, track: { artists: 'ID', title: 'Fixture Title', links: [] } }, 1),
      true,
      'a row with artists ID needs no link'
    )
    t.equal(
      isReadyToPost({ ...base, track: { ...base.track, isIdVersion: true, links: [] } }, 1),
      true,
      'an isIdVersion row needs no link'
    )
    t.equal(
      isReadyToPost({ ...base, track: { artists: 'Fixture Artist', title: 'Satisfaction (ID Remix)', links: [] } }, 1),
      true,
      'a title with the word ID needs no link'
    )
    t.equal(
      isReadyToPost({ ...base, track: { artists: 'Fixture Artist', title: 'Idle Hands', links: [] } }, 1),
      false,
      'a title with Idle is not an ID row'
    )
    t.end()
  })

  t.test('rowNumbers', (t) => {
    const complete = (n) => decisionRow({ start: { seconds: n, from: 'best' }, track: { artists: `Artist ${n}`, title: `Title ${n}` } })
    const incomplete = decisionRow({ start: null, track: null })
    const idRow = decisionRow({ start: { seconds: 9, from: 'best' }, track: { isId: true } })
    const noLinkRow = decisionRow({ start: { seconds: 9, from: 'best' }, track: { artists: 'A', title: 'T', links: [] } })

    t.same(rowNumbers([complete(1), complete(2), complete(3)]), [1, 2, 3], 'a run of complete rows counts up')
    t.same(rowNumbers([complete(1), incomplete, complete(3)]), [1, null, null], 'the walk stops at the first incomplete row')
    t.same(rowNumbers([idRow]), [1], 'an ID row counts')
    t.same(rowNumbers([noLinkRow]), [1], 'a row with no link still counts')
    t.same(rowNumbers([]), [], 'an empty list gives an empty list')
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

  t.test('a merge down never turns a decided surviving row into an undecided one', async (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO95'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow(), makeMergedRow()] })
    const before = getSet(videoId)
    await updateRow(videoId, before.rows[0].id, {
      start: { seconds: 10, from: 'best' },
      track: { artists: 'Kept Artist', title: 'Kept Title' },
      note: 'kept note',
    })

    await mergeRow(videoId, before.rows[0].id, 'down')
    const after = getSet(videoId)

    t.equal(after.rows.length, 1)
    t.same(after.rows[0].start, { seconds: 10, from: 'best' })
    t.same(after.rows[0].track, { artists: 'Kept Artist', title: 'Kept Title' })
    t.equal(after.rows[0].note, 'kept note')
    t.end()
  })

  t.test('it merges an empty added row with a sourced row without a min or max failure', async (t) => {
    const dir = makeEmptyDataDir(t)
    useDataDir(dir)
    const videoId = 'TESTVIDEO96'
    writeMergedFile(dir, videoId, '20260101T000000Z-x.json', { rows: [makeMergedRow()] })
    const before = getSet(videoId)
    await insertEmptyRow(videoId, before.rows[0].id, 'above')
    const added = getSet(videoId)
    t.equal(added.rows[0].span, null)

    await mergeRow(videoId, added.rows[0].id, 'down')
    const after = getSet(videoId)

    t.equal(after.rows.length, 1)
    t.equal(after.rows[0].merged.length, 1)
    t.not(after.rows[0].span, null)
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
