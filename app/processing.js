import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const running = new Set()

function dataDir() {
  return resolve(process.env.SETBRAINZ_DATA_DIR || 'data')
}

function validateVideoId(videoId) {
  if (!/^[A-Za-z0-9_-]+$/.test(videoId)) throw Object.assign(new Error('invalid set id'), { code: 'invalid_video_id' })
}

function jobPath(videoId) {
  validateVideoId(videoId)
  return join(dataDir(), 'jobs', `${videoId}.json`)
}

function readStatus(videoId) {
  const path = jobPath(videoId)
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
}

function processGroupExists(groupId) {
  if (!groupId) return false
  try {
    process.kill(-groupId, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

function mp3Files(videoId) {
  validateVideoId(videoId)
  const path = join(dataDir(), 'audio', videoId)
  return existsSync(path) ? readdirSync(path).filter((name) => name.endsWith('.mp3')) : []
}

function writeStatus(status) {
  const path = jobPath(status.videoId)
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(status, null, 2)}\n`)
  renameSync(temp, path)
}

function run(command, args, onSpawn) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, SETBRAINZ_DATA_DIR: dataDir() },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    })
    onSpawn(child.pid)
    let output = ''
    child.stdout.on('data', (chunk) => { output = `${output}${chunk}`.slice(-4000) })
    child.stderr.on('data', (chunk) => { output = `${output}${chunk}`.slice(-4000) })
    child.on('error', rejectRun)
    child.on('close', (code, signal) => {
      if (code === 0) resolveRun()
      else rejectRun(new Error(output.trim() || `Command failed with exit code ${code ?? signal}`))
    })
  })
}

function begin(videoId, phase, initialStep) {
  validateVideoId(videoId)
  if (running.has(videoId)) throw Object.assign(new Error('work is already running for this set'), { code: 'processing_in_progress' })
  const previous = readStatus(videoId)
  if (previous?.status === 'queued' || previous?.status === 'running') {
    if (processGroupExists(previous.processGroupId)) {
      throw Object.assign(new Error('work is already running for this set'), { code: 'processing_in_progress' })
    }
    update(previous, {
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error: 'work stopped when the app server stopped',
      processGroupId: null,
    })
  }
  const now = new Date().toISOString()
  const status = { videoId, phase, status: 'queued', step: initialStep, startedAt: now, updatedAt: now }
  writeStatus(status)
  running.add(videoId)
  return status
}

function update(status, values) {
  Object.assign(status, values, { updatedAt: new Date().toISOString() })
  writeStatus(status)
}

function assertNoResults(videoId) {
  validateVideoId(videoId)
  const data = dataDir()
  const mergedDir = join(data, 'merged', videoId)
  const decisions = join(data, 'decisions', `${videoId}.json`)
  if ((existsSync(mergedDir) && readdirSync(mergedDir).some((name) => name.endsWith('.json'))) || existsSync(decisions)) {
    throw Object.assign(new Error(`set ${videoId} already has merged results or decisions`), { code: 'existing_results' })
  }
}

async function execute(status, tasks) {
  update(status, { status: 'running' })
  try {
    for (const [step, command, args] of tasks) {
      update(status, { step })
      await run(command, args, (processGroupId) => update(status, { processGroupId }))
    }
    update(status, { status: 'completed', step: null, finishedAt: new Date().toISOString(), processGroupId: null })
  } catch (error) {
    update(status, { status: 'failed', finishedAt: new Date().toISOString(), processGroupId: null, error: error.message })
  } finally {
    running.delete(status.videoId)
  }
}

export function startDownload(videoId, sourceUrl) {
  if (typeof sourceUrl !== 'string' || !/^https?:\/\//i.test(sourceUrl)) {
    throw Object.assign(new Error('source URL must start with http or https'), { code: 'invalid_source_url' })
  }
  assertNoResults(videoId)
  if (mp3Files(videoId).length) {
    throw Object.assign(new Error(`audio already exists for set ${videoId}`), { code: 'audio_exists' })
  }
  const status = begin(videoId, 'download', 'download')
  void execute(status, [['download', 'bash', [join(root, 'scripts/download-audio.sh'), videoId, sourceUrl]]])
  return status
}

export function startProcessing(videoId) {
  const downloadStatus = readStatus(videoId)
  if (downloadStatus?.phase === 'download' && downloadStatus.status !== 'completed') {
    if ((downloadStatus.status === 'queued' || downloadStatus.status === 'running') && !running.has(videoId) && !processGroupExists(downloadStatus.processGroupId)) {
      update(downloadStatus, {
        status: 'failed',
        finishedAt: new Date().toISOString(),
        error: 'work stopped when the app server stopped',
        processGroupId: null,
      })
    }
    throw Object.assign(new Error(`download for set ${videoId} did not complete`), { code: 'download_incomplete' })
  }
  const mp3s = mp3Files(videoId)
  if (!mp3s.length) throw Object.assign(new Error(`no MP3 audio for set ${videoId}`), { code: 'missing_audio' })
  const data = dataDir()
  assertNoResults(videoId)
  const status = begin(videoId, 'process', 'tracklistify')
  void execute(status, [
    ['tracklistify', 'bash', [join(root, 'scripts/run-tracklistify.sh'), videoId]],
    ['ripthatset', 'bash', [join(root, 'scripts/run-ripthatset.sh'), videoId]],
    ['merge', 'python3', [join(root, 'scripts/merge-results.py'), videoId]],
  ])
  return status
}

export function getProcessingStatus(videoId) {
  const status = readStatus(videoId)
  if (!status) return { videoId, status: 'idle', audioExists: mp3Files(videoId).length > 0 }
  if ((status.status === 'queued' || status.status === 'running') && !running.has(videoId) && !processGroupExists(status.processGroupId)) {
    update(status, {
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error: 'work stopped when the app server stopped',
      processGroupId: null,
    })
  }
  return { ...status, audioExists: mp3Files(videoId).length > 0 }
}

export function isDownloaded(videoId) {
  return mp3Files(videoId).length > 0
}
