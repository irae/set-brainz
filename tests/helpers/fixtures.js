import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const VIDEO_ID = 'TESTVIDEO01'
const SEG = 12
const TOTAL_SEGMENTS = 1002

const STEADY = { realStart: 98, realEnd: 101, artist: 'Fixture Artist', title: 'Fixture Track B' }
const LATE = { realStart: 1000, realEnd: 1001, artist: 'Fixture Artist', title: 'Fixture Track A' }

const DECLARED_POSITIONS = {
  plain: { steady: [99, 100, 101, 102], late: [1001, 1002] },
  'old-bug': { steady: [99, 100, 101, 104], late: [102, 103] },
}

function hms(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':')
}

function foundLine(position, artist, title) {
  return `◆ Found [${hms((position - 1) * SEG)}] (segment ${position}): ${artist} - ${title} via shazam`
}

function ripThatSetLog(order) {
  const positions = DECLARED_POSITIONS[order]
  const lines = [`Processing ${TOTAL_SEGMENTS} segments in batches of 15 using Shazam...`]
  for (const p of positions.steady) lines.push(foundLine(p, STEADY.artist, STEADY.title))
  for (const p of positions.late) lines.push(foundLine(p, LATE.artist, LATE.title))
  lines.push('', 'Analysis Summary:', `Total Segments: ${TOTAL_SEGMENTS}`, 'Detected Tracks: 2', 'Success Rate: 0.6%')
  return lines.join('\n') + '\n'
}

function tracklistifyJson() {
  const steadyStart = STEADY.realStart * SEG
  return JSON.stringify(
    {
      mix_info: {
        title: 'Fixture Set',
        artist: 'Unknown artist',
        date: '2026-01-01',
        track_count: 1,
        total_duration: 0,
      },
      analysis_info: {
        timestamp: '2026-01-01T00:00:00',
        track_count: 1,
        average_confidence: 88,
        min_confidence: 88,
        max_confidence: 88,
      },
      track_count: 1,
      tracks: [
        {
          song_name: `${STEADY.title} (Radio Edit)`,
          artist: STEADY.artist,
          time_in_mix: hms(steadyStart),
          confidence: 88,
          duration: null,
          metadata: { links: { spotify: 'https://open.spotify.com/track/fixture' } },
        },
      ],
    },
    null,
    2,
  )
}

export function waitForNextSecond() {
  const startSecond = Math.floor(Date.now() / 1000)
  return new Promise((resolve) => {
    const check = () => {
      if (Math.floor(Date.now() / 1000) > startSecond) resolve()
      else setTimeout(check, 20)
    }
    check()
  })
}

export function makeDataDir(t, { order = 'plain' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'set-brainz-'))
  const runsDir = join(dir, 'runs', VIDEO_ID)
  mkdirSync(join(runsDir, 'tracklistify'), { recursive: true })
  mkdirSync(join(runsDir, 'ripthatset'), { recursive: true })
  writeFileSync(join(runsDir, 'tracklistify', 'tracklist.json'), tracklistifyJson())
  writeFileSync(join(runsDir, 'ripthatset', 'run.log'), ripThatSetLog(order))
  t.teardown(() => rmSync(dir, { recursive: true, force: true }))
  return { dir, videoId: VIDEO_ID }
}
