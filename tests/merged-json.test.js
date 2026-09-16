import { test } from 'tap'
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeDataDir, waitForNextSecond } from './helpers/fixtures.js'

const SCRIPT = fileURLToPath(new URL('../scripts/merge-results.py', import.meta.url))

function runMerge(dir, videoId, extraArgs = []) {
  const args = [SCRIPT, ...(videoId ? [videoId] : []), ...extraArgs]
  return spawnSync('python3', args, {
    env: { ...process.env, SETBRAINZ_DATA_DIR: dir },
    encoding: 'utf8',
  })
}

function mergedFiles(dir, videoId) {
  return readdirSync(join(dir, 'merged', videoId)).sort()
}

function readMerged(dir, videoId, filename) {
  return JSON.parse(readFileSync(join(dir, 'merged', videoId, filename), 'utf8'))
}

test('merge script writes a file named <timestamp>-<video-id>.json under merged/<video-id>/', (t) => {
  const { dir, videoId } = makeDataDir(t)
  const result = runMerge(dir, videoId)
  t.equal(result.status, 0, result.stderr)
  const files = mergedFiles(dir, videoId)
  t.equal(files.length, 1)
  t.match(files[0], new RegExp(`^\\d{8}T\\d{6}Z-${videoId}\\.json$`))
  t.end()
})

test('merge script gives the same row uuid for the same row content in two runs', async (t) => {
  const { dir, videoId } = makeDataDir(t)
  runMerge(dir, videoId)
  await waitForNextSecond()
  runMerge(dir, videoId, ['--force'])
  const files = mergedFiles(dir, videoId)
  t.equal(files.length, 2)
  const first = readMerged(dir, videoId, files[0])
  const second = readMerged(dir, videoId, files[1])
  t.same(
    first.rows.map((r) => r.uuid),
    second.rows.map((r) => r.uuid),
  )
  t.same(
    first.rows.map((r) => r.sha),
    second.rows.map((r) => r.sha),
  )
  t.end()
})

test('merge script keeps every variant of a track, with counts from both tools', (t) => {
  const { dir, videoId } = makeDataDir(t)
  runMerge(dir, videoId)
  const files = mergedFiles(dir, videoId)
  const doc = readMerged(dir, videoId, files[0])
  const row = doc.rows.find((r) => r.kind === 'track' && r.variants.some((v) => v.title === 'Fixture Track B'))
  t.ok(row, 'row for the steady track exists')
  t.equal(row.variants.length, 2)
  const ripthatsetVariant = row.variants.find((v) => v.title === 'Fixture Track B')
  const tracklistifyVariant = row.variants.find((v) => v.title === 'Fixture Track B (Radio Edit)')
  t.ok(ripthatsetVariant, 'ripthatset variant kept')
  t.ok(tracklistifyVariant, 'tracklistify variant kept')
  t.equal(ripthatsetVariant.ripthatset.length, 1)
  t.equal(ripthatsetVariant.ripthatset[0].count, 4)
  t.equal(tracklistifyVariant.tracklistify.length, 1)
  t.equal(tracklistifyVariant.tracklistify[0].confidence, 88)
  t.end()
})

test('merge script writes gap rows for 90 s or more without hits', (t) => {
  const { dir, videoId } = makeDataDir(t)
  runMerge(dir, videoId)
  const files = mergedFiles(dir, videoId)
  const doc = readMerged(dir, videoId, files[0])
  const gapRows = doc.rows.filter((r) => r.kind === 'gap')
  t.ok(gapRows.length > 0, 'at least one gap row')
  for (const row of gapRows) {
    t.ok(row.latest - row.earliest >= 90)
    t.same(row.variants, [])
  }
  t.end()
})

test('merge script writes nothing and warns when the newest file has the same rows', (t) => {
  const { dir, videoId } = makeDataDir(t)
  runMerge(dir, videoId)
  const before = mergedFiles(dir, videoId)
  const second = runMerge(dir, videoId)
  const after = mergedFiles(dir, videoId)
  t.same(after, before, 'no new file written')
  t.match(second.stderr, /no changes|nothing written/i)
  t.end()
})

test('merge script writes a second file when --force is given', async (t) => {
  const { dir, videoId } = makeDataDir(t)
  runMerge(dir, videoId)
  await waitForNextSecond()
  runMerge(dir, videoId, ['--force'])
  const files = mergedFiles(dir, videoId)
  t.equal(files.length, 2)
  t.end()
})

test('merge script reports which chunk order it used', (t) => {
  const { dir, videoId } = makeDataDir(t, { order: 'plain' })
  const result = runMerge(dir, videoId)
  t.match(result.stderr, /chunk order/i)
  t.end()
})

test('merge script uses the repaired chunk order for a log from the old tool', (t) => {
  const { dir, videoId } = makeDataDir(t, { order: 'old-bug' })
  const result = runMerge(dir, videoId)
  t.equal(result.status, 0, result.stderr)
  t.match(result.stderr, /repaired/i)
  const files = mergedFiles(dir, videoId)
  const doc = readMerged(dir, videoId, files[0])
  const row = doc.rows.find((r) => r.kind === 'track' && r.variants.some((v) => v.title === 'Fixture Track A'))
  t.ok(row, 'row for the late track exists')
  t.equal(row.earliest, 12000)
  t.equal(row.latest, 12024)
  t.end()
})

test('merge script uses the plain chunk order for a log from the patched tool', (t) => {
  const { dir, videoId } = makeDataDir(t, { order: 'plain' })
  const result = runMerge(dir, videoId)
  t.equal(result.status, 0, result.stderr)
  t.match(result.stderr, /plain/i)
  const files = mergedFiles(dir, videoId)
  const doc = readMerged(dir, videoId, files[0])
  const row = doc.rows.find((r) => r.kind === 'track' && r.variants.some((v) => v.title === 'Fixture Track A'))
  t.ok(row, 'row for the late track exists')
  t.equal(row.earliest, 12000)
  t.equal(row.latest, 12024)
  t.end()
})

test('merge script fails with a clear message when the video id is missing', (t) => {
  const { dir } = makeDataDir(t)
  const result = runMerge(dir, null)
  t.not(result.status, 0)
  t.match(result.stderr, /video id/i)
  t.end()
})
