import { test } from 'tap'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { makeEmptyDataDir } from './helpers/fixtures.js'
import { getProcessingStatus, startDownload } from '../app/processing.js'

test('a job started in a detached runner (functional)', async (t) => {
  const dir = makeEmptyDataDir(t)
  process.env.SETBRAINZ_DATA_DIR = dir
  const videoId = 'TESTVIDEO01'

  const started = startDownload(videoId, 'http://127.0.0.1:9/fixture')
  const status = getProcessingStatus(videoId)

  t.equal(status.status, 'queued', 'a status read just after the start sees a live job')
  t.equal(status.processGroupId, started.processGroupId)
  t.throws(() => startDownload(videoId, 'http://127.0.0.1:9/fixture'), { code: 'processing_in_progress' }, 'a second start of the same set is refused')

  let final = status
  for (let i = 0; i < 300 && (final.status === 'queued' || final.status === 'running'); i++) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    final = getProcessingStatus(videoId)
  }
  t.equal(final.status, 'failed', 'the runner writes the end of the job')
  t.equal(final.processGroupId, null)
  t.not(final.error, 'work stopped when the app server stopped', 'the error holds the output of the step')
  t.end()
})

test('a status read after a runner crash points to the runner log (unit)', async (t) => {
  const dir = makeEmptyDataDir(t)
  process.env.SETBRAINZ_DATA_DIR = dir
  const videoId = 'TESTVIDEO02'
  const write = (startedAt) => {
    mkdirSync(join(dir, 'jobs'), { recursive: true })
    writeFileSync(join(dir, 'jobs', `${videoId}.json`), JSON.stringify({ videoId, phase: 'download', status: 'running', startedAt, processGroupId: 2 ** 22 + 12345 }))
  }

  write(new Date().toISOString())
  t.equal(getProcessingStatus(videoId).error, 'work stopped when the app server stopped', 'no runner output means the server stopped')

  write(new Date(Date.now() - 1000).toISOString())
  mkdirSync(join(dir, 'runs', videoId), { recursive: true })
  writeFileSync(join(dir, 'runs', videoId, 'runner.log'), 'Error: boom\n')
  const status = getProcessingStatus(videoId)
  t.equal(status.status, 'failed')
  t.match(status.error, /runner stopped.*runs\/TESTVIDEO02\/runner\.log/)

  write(new Date(Date.now() + 60000).toISOString())
  t.equal(getProcessingStatus(videoId).error, 'work stopped when the app server stopped', 'output of an older job does not count')
  t.end()
})

test('the download script never runs yt-dlp over existing audio (functional)', async (t) => {
  const dir = makeEmptyDataDir(t)
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'yt-dlp'), `#!/bin/sh\ntouch "${join(dir, 'yt-dlp-ran')}"\n`)
  chmodSync(join(bin, 'yt-dlp'), 0o755)
  const download = (videoId) => spawnSync('bash', ['scripts/download-audio.sh', videoId, 'http://127.0.0.1:9/fixture'], {
    encoding: 'utf8',
    env: { ...process.env, SETBRAINZ_DATA_DIR: dir, PATH: `${bin}:${process.env.PATH}` },
  })

  mkdirSync(join(dir, 'audio', 'TESTVIDEO01'), { recursive: true })
  writeFileSync(join(dir, 'audio', 'TESTVIDEO01', 'fixture.mp3'), 'kept')
  const refused = download('TESTVIDEO01')
  t.equal(refused.status, 1)
  t.match(refused.stderr, /audio already exists for set TESTVIDEO01/)
  t.notOk(existsSync(join(dir, 'yt-dlp-ran')), 'yt-dlp does not run')
  t.equal(readFileSync(join(dir, 'audio', 'TESTVIDEO01', 'fixture.mp3'), 'utf8'), 'kept')

  mkdirSync(join(dir, 'audio', 'TESTVIDEO02'), { recursive: true })
  writeFileSync(join(dir, 'audio', 'TESTVIDEO02', 'fixture.webm'), 'partial')
  t.equal(download('TESTVIDEO02').status, 0, 'a folder with no MP3 still downloads')
  t.ok(existsSync(join(dir, 'yt-dlp-ran')))
  t.end()
})
