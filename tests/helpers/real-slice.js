import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const SLICE_SECONDS = 1800

function findRealDataDir() {
  const candidates = [resolve(process.env.SETBRAINZ_REAL_DATA_DIR || 'data')]
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim()
    candidates.push(join(dirname(common), 'data'))
  } catch {}
  const found = candidates.find((dir) => existsSync(join(dir, 'merged')))
  if (!found) throw new Error('no real data folder found; set SETBRAINZ_REAL_DATA_DIR')
  return found
}

export function buildRealSlice(t) {
  const real = findRealDataDir()
  const videoId = readdirSync(join(real, 'merged')).sort()[0]
  const mergedName = readdirSync(join(real, 'merged', videoId)).filter((f) => f.endsWith('.json')).sort().pop()
  const merged = JSON.parse(readFileSync(join(real, 'merged', videoId, mergedName), 'utf8'))
  const rows = merged.rows.filter((row) => row.earliest < SLICE_SECONDS)
  const kept = new Set(rows.map((row) => row.uuid))

  const dir = mkdtempSync(join(tmpdir(), 'set-brainz-slice-'))
  t.teardown(() => rmSync(dir, { recursive: true, force: true }))
  mkdirSync(join(dir, 'merged', videoId), { recursive: true })
  writeFileSync(join(dir, 'merged', videoId, mergedName), JSON.stringify({ ...merged, rows }))

  const decisions = JSON.parse(readFileSync(join(real, 'decisions', `${videoId}.json`), 'utf8'))
  const decisionRows = decisions.rows
    .map((row) => ({ ...row, sources: row.sources.filter((uuid) => kept.has(uuid)), posted: null, postHistory: undefined }))
    .filter((row) => row.sources.length || (row.start && row.start.seconds < SLICE_SECONDS))
  mkdirSync(join(dir, 'decisions'), { recursive: true })
  writeFileSync(join(dir, 'decisions', `${videoId}.json`), JSON.stringify({ ...decisions, rows: decisionRows }))

  if (existsSync(join(real, 'sets.json'))) {
    const sets = JSON.parse(readFileSync(join(real, 'sets.json'), 'utf8'))
    if (sets[videoId]) writeFileSync(join(dir, 'sets.json'), JSON.stringify({ [videoId]: sets[videoId] }))
  }
  return { dir, videoId }
}
